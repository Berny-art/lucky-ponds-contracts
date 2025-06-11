// scripts/run-upkeep-custom.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("🔄 Starting upkeep process for PondCore...");
	console.log(
		"This script will check for ponds that need winner selection and perform upkeep",
	);

	// Get custom contract address from environment variable
	const customContractAddress = process.env.CUSTOM_CONTRACT;

	// Get network information
	const network = await ethers.provider.getNetwork();
	const networkName = network.name;
	const isTestnet =
		networkName.includes("testnet") || networkName === "hyperliquid_testnet";
	const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

	console.log(
		`🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`,
	);
	console.log(`⛓️ Chain ID: ${network.chainId}`);

	// Load contract addresses from environment or use custom address
	let pondCoreAddress = customContractAddress || process.env[`${configPrefix}_POND_CORE_ADDRESS`];
	
	if (customContractAddress) {
		console.log(`🎯 Using custom contract address: ${customContractAddress}`);
	}

	// Validate addresses
	if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
		throw new Error(`❌ Missing or invalid PondCore address. Use --contract <address> or set ${configPrefix}_POND_CORE_ADDRESS`);
	}

	console.log("📋 Contract Address:");
	console.log(`- 🌟 PondCore: ${pondCoreAddress}`);

	// Get deployer account
	const [deployer] = await ethers.getSigners();
	console.log(`\n👨‍💻 Using account: ${deployer.address}`);

	// Check deployer balance
	const deployerBalance = await ethers.provider.getBalance(deployer.address);
	console.log(`💎 Balance: ${ethers.formatEther(deployerBalance)} ETH`);

	// Connect to contracts
	try {
		console.log("\n🔌 Connecting to PondCore...");

		const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

		// Check if upkeep is needed
		console.log("\n🔍 Checking if upkeep is needed...");

		const [upkeepNeeded, performData] = await pondCore.checkUpkeep("0x");

		if (!upkeepNeeded) {
			console.log("✅ No upkeep needed at this time.");
			console.log(
				"💡 This means either no ponds have ended or timelock periods haven't passed yet.",
			);
			return;
		}

		console.log("🚨 Upkeep needed! A pond requires winner selection.");

		// Decode the perform data to see which pond needs upkeep
		try {
			const pondType = ethers.AbiCoder.defaultAbiCoder().decode(
				["bytes32"],
				performData,
			)[0];
			console.log(`🏊 Pond requiring upkeep: ${pondType}`);

			// Get pond information
			try {
				const pondStatus = await pondCore.getPondStatus(pondType);
				console.log(`📊 Pond name: ${pondStatus[0]}`);
				console.log(`👥 Total participants: ${pondStatus[5]}`);
				console.log(`💰 Total value: ${ethers.formatEther(pondStatus[4])} ETH`);
				console.log(`🏆 Prize distributed: ${pondStatus[6]}`);
			} catch (error) {
				console.warn(`⚠️ Could not get pond details: ${error.message}`);
			}
		} catch (error) {
			console.warn(`⚠️ Could not decode pond type: ${error.message}`);
		}

		// Estimate gas for the upkeep operation
		console.log("\n⛽ Estimating gas for upkeep...");
		let gasEstimate;
		try {
			gasEstimate = await pondCore.performUpkeep.estimateGas(performData);
			console.log(`📊 Estimated gas: ${gasEstimate.toLocaleString()} units`);
		} catch (error) {
			console.warn(`⚠️ Could not estimate gas: ${error.message}`);
			gasEstimate = ethers.parseUnits("500000", "wei"); // 500k gas fallback
			console.log(
				`🔧 Using fallback gas limit: ${gasEstimate.toLocaleString()} units`,
			);
		}

		// Get current gas price
		const feeData = await ethers.provider.getFeeData();
		const gasPrice = feeData.gasPrice;

		if (gasPrice) {
			const estimatedCost = gasEstimate * gasPrice;
			console.log(
				`💸 Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`,
			);
		}

		// Perform the upkeep
		console.log("\n🚀 Performing upkeep...");

		// Add a safety margin to gas estimate
		const gasLimit = (gasEstimate * 120n) / 100n; // 20% safety margin

		try {
			const tx = await pondCore.performUpkeep(performData, {
				gasLimit: gasLimit,
			});

			console.log(`📤 Upkeep transaction sent: ${tx.hash}`);
			console.log("⏳ Waiting for confirmation...");

			const receipt = await tx.wait();

			console.log("✅ Upkeep completed successfully!");
			console.log(`🔗 Transaction hash: ${receipt.hash}`);
			console.log(`⛽ Gas used: ${receipt.gasUsed.toLocaleString()} units`);

			// Check for events
			if (receipt.logs && receipt.logs.length > 0) {
				console.log(`📝 ${receipt.logs.length} events emitted`);

				// Try to parse WinnerSelected events
				const winnerSelectedSignature = ethers.id(
					"WinnerSelected(bytes32,address,uint256,uint256)",
				);

				for (const log of receipt.logs) {
					if (log.topics[0] === winnerSelectedSignature) {
						try {
							const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
								["bytes32", "address", "uint256", "uint256"],
								log.data,
							);
							console.log(`🏆 Winner selected: ${decoded[1]}`);
							console.log(
								`💰 Prize amount: ${ethers.formatEther(decoded[2])} ETH`,
							);
						} catch (parseError) {
							console.log(
								"📝 WinnerSelected event detected (could not parse details)",
							);
						}
					}
				}
			}

			// Log the result
			const logsDir = path.join(__dirname, "../logs");
			if (!fs.existsSync(logsDir)) {
				fs.mkdirSync(logsDir, { recursive: true });
			}

			const timestamp = Math.floor(Date.now() / 1000);
			const logPath = path.join(logsDir, `upkeep_success_${timestamp}.json`);

			const upkeepLog = {
				timestamp: new Date().toISOString(),
				network: networkName,
				chainId: Number(network.chainId),
				pondCore: pondCoreAddress,
				transactionHash: receipt.hash,
				gasUsed: Number(receipt.gasUsed),
				success: true,
			};

			fs.writeFileSync(logPath, JSON.stringify(upkeepLog, null, 2));
			console.log(`\n💾 Success log saved to: ${logPath}`);
		} catch (error) {
			console.error(`❌ Upkeep failed: ${error.message}`);

			// Try to provide more detailed error information
			if (error.code === "CALL_EXCEPTION") {
				console.error(
					"💡 This might be due to insufficient permissions or invalid pond state",
				);
			}

			if (error.transaction) {
				console.log(`🔍 Transaction that failed: ${error.transaction.hash}`);
			}

			throw error;
		}

		console.log("\n🏁 Upkeep process completed successfully!");
	} catch (error) {
		console.error("\n❌ Error during upkeep process:");
		console.error(error);

		// Save error log
		const logsDir = path.join(__dirname, "../logs");
		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const logPath = path.join(logsDir, `upkeep_error_${timestamp}.json`);

		const errorLog = {
			timestamp: new Date().toISOString(),
			network: networkName,
			chainId: Number(network.chainId),
			pondCore: pondCoreAddress,
			error: {
				message: error.message,
				stack: error.stack,
			},
		};

		fs.writeFileSync(logPath, JSON.stringify(errorLog, null, 2));
		console.log(`\n💾 Error log saved to: ${logPath}`);

		throw error;
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("❌ Script error:", error);
		process.exit(1);
	});

// Usage: CUSTOM_CONTRACT=0xe225F846DFa0DE15dd60f4E4238a41E7e4f283ED npx hardhat run scripts/run-upkeep-custom.js --network hyperliquid_mainnet
