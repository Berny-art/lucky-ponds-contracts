// tasks/emergency-refund.js
const { Table } = require("console-table-printer");

// Helper function to format ETH amounts
function formatEther(amount) {
	return `${ethers.formatEther(amount)} ETH`;
}

task("emergency-refund", "Execute emergency refund for a pond in batches")
	.addParam("pondtype", "Pond type identifier (bytes32 hex string)")
	.addOptionalParam(
		"batchsize",
		"Number of participants to process per batch",
		"10",
	)
	.addOptionalParam("startindex", "Starting index for batch processing", "0")
	.addOptionalParam("endindex", "Ending index for batch processing (optional)")
	.addOptionalParam("contract", "Custom PondCore contract address to use instead of deployed one")
	.addFlag("dryrun", "Simulate the transaction without executing")
	.setAction(async (taskArgs, hre) => {
		const { ethers } = hre;

		console.log("🚨 Emergency Refund Tool");

		// Get network information
		const network = await ethers.provider.getNetwork();
		const networkName = network.name;
		const isTestnet =
			networkName.includes("testnet") || networkName === "hyperliquid_testnet";
		const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

		console.log(
			`🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`,
		);

		// Get addresses from environment or deployment files
		let pondCoreAddress = taskArgs.contract || process.env[`${configPrefix}_POND_CORE_ADDRESS`];
		
		// If contract parameter provided, use it
		if (taskArgs.contract) {
			console.log(`🎯 Using custom contract address: ${taskArgs.contract}`);
		}
		// If not in environment, try to load from latest deployment
		else if (!pondCoreAddress) {
			try {
				const fs = require('fs');
				const path = require('path');
				const deploymentsDir = path.join(__dirname, '..', 'deployments');
				const files = fs.readdirSync(deploymentsDir);
				
				// Find the latest deployment file for this network
				const networkFiles = files.filter(f => f.includes(networkName) && f.endsWith('.json'));
				if (networkFiles.length > 0) {
					// Sort by timestamp (assuming filename format includes timestamp)
					networkFiles.sort().reverse();
					const latestDeployment = networkFiles[0];
					const deploymentPath = path.join(deploymentsDir, latestDeployment);
					const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
					pondCoreAddress = deployment.PondCore;
					console.log(`📂 Using PondCore from deployment: ${latestDeployment}`);
				}
			} catch (error) {
				console.warn(`⚠️  Could not load deployment file: ${error.message}`);
			}
		}
		
		// Fallback to hardcoded address if nothing found
		if (!pondCoreAddress) {
			pondCoreAddress = '0x215126f193C19b460e109Dceae149EDfd30B6FDe'; // Updated to correct address
			console.log(`⚠️  Using fallback PondCore address`);
		}
		
		const privateKey = process.env.PRIVATE_KEY;

		if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
			throw new Error(
				"❌ No valid PondCore address found in environment variables",
			);
		}

		if (!privateKey) {
			throw new Error("❌ No PRIVATE_KEY found in environment variables");
		}

		// Create wallet and connect to provider
		const wallet = new ethers.Wallet(privateKey, ethers.provider);
		console.log(`👤 Using wallet: ${wallet.address}`);
		console.log(`🌟 Using PondCore: ${pondCoreAddress}`);

		// Connect to PondCore
		const pondCore = await ethers.getContractAt(
			"PondCore",
			pondCoreAddress,
			wallet,
		);

		// Parse pond type
		let pondType = taskArgs.pondtype;
		
		// Handle different pond type formats
		if (pondType.startsWith("0x")) {
			// If it's a hex string, check if it's properly formatted as bytes32
			if (pondType.length !== 66) { // 0x + 64 hex characters = 66 total
				// If it's a shorter hex string, try to decode it as a string first
				try {
					// Remove 0x prefix and convert hex to string
					const hexWithoutPrefix = pondType.slice(2);
					const decodedString = Buffer.from(hexWithoutPrefix, 'hex').toString('utf8');
					// Re-encode as proper bytes32
					pondType = ethers.encodeBytes32String(decodedString);
					console.log(`🔧 Converted hex to string "${decodedString}" and re-encoded as bytes32`);
				} catch (error) {
					// If conversion fails, pad the hex string to 32 bytes
					const hexWithoutPrefix = pondType.slice(2);
					pondType = "0x" + hexWithoutPrefix.padEnd(64, '0');
					console.log(`🔧 Padded short hex string to bytes32`);
				}
			}
		} else {
			// If it's a plain string, encode it as bytes32
			pondType = ethers.encodeBytes32String(pondType);
		}

		console.log(`🏊 Processing pond: ${pondType}`);

		try {
			// Get pond status to verify it exists
			const pondStatus = await pondCore.getPondStatus(pondType);
			const participants = await pondCore.getPondParticipants(pondType);

			console.log("\n📊 Pond Information:");
			console.log(`- Name: ${pondStatus[0]}`);
			console.log(`- Total Participants: ${pondStatus[5]}`);
			console.log(`- Total Value: ${formatEther(pondStatus[4])}`);
			console.log(
				`- Token Type: ${
					Number(pondStatus[10]) === 0 ? "NATIVE ETH" : "ERC20"
				}`,
			);
			console.log(`- Prize Distributed: ${pondStatus[6]}`);

			if (pondStatus[10] === 1) {
				console.log(`- Token Address: ${pondStatus[11]}`);
			}

			const totalParticipants = participants.length;

			if (totalParticipants === 0) {
				console.log("❌ No participants found in this pond.");
				return;
			}

			// Parse batch parameters
			const batchSize = Number.parseInt(taskArgs.batchsize);
			const startIndex = Number.parseInt(taskArgs.startindex);
			let endIndex = taskArgs.endindex
				? Number.parseInt(taskArgs.endindex)
				: totalParticipants;

			// Validate indices
			if (startIndex >= totalParticipants) {
				throw new Error(
					`Start index ${startIndex} is greater than total participants ${totalParticipants}`,
				);
			}

			if (endIndex > totalParticipants) {
				endIndex = totalParticipants;
			}

			if (startIndex >= endIndex) {
				throw new Error(
					`Invalid range: start index ${startIndex} >= end index ${endIndex}`,
				);
			}

			console.log(
				`\n🎯 Processing Range: ${startIndex} to ${endIndex - 1} (${
					endIndex - startIndex
				} participants)`,
			);

			// Show participants in range
			console.log("\n👥 Participants to be refunded:");
			const table = new Table({
				columns: [
					{ name: "index", title: "Index", alignment: "right" },
					{ name: "address", title: "Address", alignment: "left" },
					{ name: "amount", title: "Toss Amount", alignment: "right" },
				],
			});

			const rangeToShow = Math.min(10, endIndex - startIndex);
			for (let i = startIndex; i < startIndex + rangeToShow; i++) {
				const participant = participants[i];
				table.addRow({
					index: i,
					address: participant.participant,
					amount: formatEther(participant.tossAmount),
				});
			}

			if (endIndex - startIndex > rangeToShow) {
				table.addRow({
					index: "...",
					address: `... and ${endIndex - startIndex - rangeToShow} more`,
					amount: "...",
				});
			}

			table.printTable();

			if (taskArgs.dryrun) {
				console.log("\n🧪 DRY RUN MODE - No transactions will be executed");

				// Process in batches for dry run
				let currentStart = startIndex;
				let batchNumber = 1;

				while (currentStart < endIndex) {
					const currentEnd = Math.min(currentStart + batchSize, endIndex);

					console.log(`\n--- Batch ${batchNumber} (DRY RUN) ---`);
					console.log(
						`📊 Would process participants ${currentStart} to ${
							currentEnd - 1
						}`,
					);

					try {
						// Estimate gas for this batch
						const gasEstimate = await pondCore.emergencyRefundBatch.estimateGas(
							pondType,
							currentStart,
							currentEnd,
						);
						console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);

						// Calculate total amount for this batch
						let batchTotal = 0n;
						for (let i = currentStart; i < currentEnd; i++) {
							batchTotal = batchTotal + participants[i].tossAmount;
						}
						console.log(`💰 Batch total: ${formatEther(batchTotal)}`);
					} catch (error) {
						console.error(`❌ Gas estimation failed: ${error.message}`);
					}

					currentStart = currentEnd;
					batchNumber++;
				}

				console.log(
					`\n✅ DRY RUN COMPLETE - ${
						batchNumber - 1
					} batches would be processed`,
				);
				return;
			}

			// Real execution
			console.log("\n🚀 EXECUTING EMERGENCY REFUND");

			let currentStart = startIndex;
			let batchNumber = 1;
			let totalRefunded = 0n;
			let totalGasUsed = 0n;

			while (currentStart < endIndex) {
				const currentEnd = Math.min(currentStart + batchSize, endIndex);

				console.log(`\n--- Batch ${batchNumber} ---`);
				console.log(
					`📊 Processing participants ${currentStart} to ${currentEnd - 1}`,
				);

				try {
					// Estimate gas
					const gasEstimate = await pondCore.emergencyRefundBatch.estimateGas(
						pondType,
						currentStart,
						currentEnd,
					);

					// Execute the transaction
					const tx = await pondCore.emergencyRefundBatch(
						pondType,
						currentStart,
						currentEnd,
						{
							gasLimit: gasEstimate + (gasEstimate * 20n) / 100n, // Add 20% buffer
						},
					);

					console.log(`📤 Transaction: ${tx.hash}`);
					console.log("⏳ Waiting for confirmation...");

					const receipt = await tx.wait();
					console.log(`✅ Batch ${batchNumber} completed!`);
					console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
					console.log(`📦 Block: ${receipt.blockNumber}`);

					totalGasUsed = totalGasUsed + receipt.gasUsed;

					// Parse events to show refund details
					const refundEvents =
						receipt.logs?.filter((log) => {
							try {
								const parsed = pondCore.interface.parseLog(log);
								return (
									parsed.name === "EmergencyAction" &&
									parsed.args?.actionType === "refund"
								);
							} catch {
								return false;
							}
						}) || [];

					let batchRefunded = 0n;
					console.log("💰 Refunds processed:");

					for (const log of refundEvents) {
						const parsed = pondCore.interface.parseLog(log);
						const amount = parsed.args.amount;
						batchRefunded = batchRefunded + amount;
						console.log(`  - ${parsed.args.recipient}: ${formatEther(amount)}`);
					}

					totalRefunded = totalRefunded + batchRefunded;
					console.log(`📊 Batch total: ${formatEther(batchRefunded)}`);
				} catch (error) {
					console.error(`❌ Batch ${batchNumber} failed: ${error.message}`);

					if (error.message.includes("InvalidParameters")) {
						console.error("💡 Invalid parameters provided");
					} else if (error.message.includes("InvalidPondType")) {
						console.error("💡 Pond type does not exist");
					} else if (error.message.includes("AccessControl")) {
						console.error("💡 Insufficient permissions - need ADMIN_ROLE");
					}

					throw error; // Stop execution on error
				}

				currentStart = currentEnd;
				batchNumber++;

				// Small delay between batches
				if (currentStart < endIndex) {
					console.log("⏱️  Waiting 2 seconds before next batch...");
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			}

			// Final summary
			console.log("\n🎉 EMERGENCY REFUND COMPLETED!");
			console.log("📊 Summary:");
			console.log(`- Batches processed: ${batchNumber - 1}`);
			console.log(`- Participants refunded: ${endIndex - startIndex}`);
			console.log(`- Total refunded: ${formatEther(totalRefunded)}`);
			console.log(`- Total gas used: ${totalGasUsed.toString()}`);

			if (endIndex === totalParticipants) {
				console.log("🔄 All participants processed - pond should now be reset");
			}
		} catch (error) {
			console.error(`❌ Emergency refund failed: ${error.message}`);

			if (error.code === "CALL_EXCEPTION") {
				console.error(
					"💡 This might be due to insufficient permissions or invalid pond state",
				);
			}

			throw error;
		}
	});

module.exports = {};


// npx hardhat emergency-refund --pondtype 0x706f6e645f74797065 --batchsize 5 --startindex 0