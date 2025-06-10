// scripts/deploy-with-emojis.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("🚀 Starting deployment process...");

	// Get network information
	const network = await ethers.provider.getNetwork();
	const networkName = network.name;
	const isTestnet =
		networkName.includes("testnet") || networkName === "hyperliquid_testnet";
	const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

	console.log(
		`🌐 Deploying to ${networkName} (${
			isTestnet ? "🧪 Testnet" : "🔴 Mainnet"
		})`,
	);
	console.log(`⛓️ Chain ID: ${network.chainId}`);

	const feeAddress =
		process.env[`${configPrefix}_FEE_ADDRESS`];
	const existingPondCoreAddress =
		process.env[`${configPrefix}_POND_CORE_ADDRESS`];

	// Updated configuration parameters for optimized contract
	const selectionTimelock = Number.parseInt(
		process.env[`${configPrefix}_SELECTION_TIMELOCK`] || "30",
	);
	const feePercentage = Number.parseInt(
		process.env[`${configPrefix}_FEE_PERCENTAGE`] || "7",
	);
	const maxParticipantsPerPond = Number.parseInt(
		process.env[`${configPrefix}_MAX_PARTICIPANTS_PER_POND`] || "3000",
	);

	if (!feeAddress)
		throw new Error(`❌ Missing ${configPrefix}_FEE_ADDRESS`);

	console.log("📋 Configuration loaded:");
	console.log(`- 💼 Fee Address: ${feeAddress}`);
	console.log(`- ⏱️ Selection Timelock: ${selectionTimelock} seconds`);
	console.log(`- 💹 Fee Percentage: ${feePercentage}%`);
	console.log(`- 👥 Max Participants Per Pond: ${maxParticipantsPerPond}`);

	if (existingPondCoreAddress) {
		console.log(`- 🌟 Using existing PondCore: ${existingPondCoreAddress}`);
	}

	// Get deployer account
	const [deployer] = await ethers.getSigners();
	console.log(`👨‍💻 Deploying with account: ${deployer.address}`);

	// Check deployer balance
	const deployerBalance = await ethers.provider.getBalance(deployer.address);
	console.log(
		`💎 Deployer balance: ${ethers.formatEther(deployerBalance)} ETH`,
	);

	// Define gas limits for complex contracts (updated for optimized version)
	const GAS_LIMITS = {
		POND_CORE: 15000000,
		POND_FACTORY: 15000000,
		GRANT_ROLE: 10000000,
	};

	console.log("\n⛽ Using gas limits:");
	for (const [contract, limit] of Object.entries(GAS_LIMITS)) {
		console.log(`- ${contract}: ${limit.toLocaleString()} gas`);
	}

	const deploymentInfo = {
		network: networkName,
		chainId: Number(network.chainId),
		deployer: deployer.address,
		timestamp: new Date().toISOString(),
		feeAddress: feeAddress,
		maxParticipantsPerPond: maxParticipantsPerPond,
	};

	try {
		// Determine PondCore address - use existing or deploy new
		let pondCoreAddress;

		if (existingPondCoreAddress && ethers.isAddress(existingPondCoreAddress)) {
			console.log("\n🔄 Using existing PondCore from .env file");
			pondCoreAddress = existingPondCoreAddress;
			deploymentInfo.pondCore = pondCoreAddress;
			console.log(`📍 PondCore address: ${pondCoreAddress}`);

			// Verify the contract exists
			try {
				const code = await ethers.provider.getCode(pondCoreAddress);
				if (code === "0x") {
					console.warn(
						`⚠️ WARNING: No contract code found at the provided PondCore address: ${pondCoreAddress}`,
					);
					console.warn(
						"Will continue anyway, but this might cause issues later.",
					);
				} else {
					console.log("✅ Contract verified at address");
				}
			} catch (error) {
				console.warn(
					`⚠️ WARNING: Error checking contract code at PondCore address: ${error.message}`,
				);
			}

			// Get the PondCore contract instance
			const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

			// Verify key parameters for optimized contract
			try {
				const config = await pondCore.getConfig();
				const actualFeeAddress = config.feeAddress;
				const actualMaxParticipants = config.maxParticipantsPerPond;
				
				if (actualFeeAddress.toLowerCase() !== feeAddress.toLowerCase()) {
					console.warn(
						`⚠️ WARNING: PondCore fee address (${actualFeeAddress}) does not match provided fee address (${feeAddress})`,
					);
				} else {
					console.log("✅ PondCore fee address matches provided fee address");
				}

				console.log(`📊 Current max participants per pond: ${actualMaxParticipants}`);
				if (actualMaxParticipants !== maxParticipantsPerPond) {
					console.warn(
						`⚠️ WARNING: PondCore max participants (${actualMaxParticipants}) does not match provided value (${maxParticipantsPerPond})`,
					);
				}
			} catch (error) {
				console.warn(
					`⚠️ WARNING: Error verifying PondCore parameters: ${error.message}`,
				);
				console.warn("This might be an older version of PondCore without getConfig() function");
			}
		} else {
			// 1. Deploy PondCore with new constructor parameters
			console.log("\n1️⃣ Deploying Optimized PondCore...");
			console.log("📝 PondCore constructor parameters:");
			console.log(`- 💼 Fee Address: ${feeAddress}`);
			console.log(`- 💹 Fee Percentage: ${feePercentage}`);
			console.log(`- ⏱️ Selection Timelock: ${selectionTimelock} seconds`);
			console.log(`- 👥 Max Participants Per Pond: ${maxParticipantsPerPond}`);

			const PondCore = await ethers.getContractFactory("PondCore");

			// Deploy with updated constructor parameters
			const pondCore = await PondCore.deploy(
				feeAddress,
				feePercentage,
				selectionTimelock,
				maxParticipantsPerPond, // New parameter
				{ gasLimit: GAS_LIMITS.POND_CORE },
			);

			console.log(
				`📤 PondCore deployment transaction sent: ${
					pondCore.deploymentTransaction().hash
				}`,
			);
			await pondCore.waitForDeployment();
			pondCoreAddress = await pondCore.getAddress();

			console.log(`🎉 Optimized PondCore deployed to: ${pondCoreAddress}`);
			deploymentInfo.pondCore = pondCoreAddress;

			// Verify deployment by checking configuration
			try {
				const config = await pondCore.getConfig();
				console.log("✅ PondCore configuration verified:");
				console.log(`- Fee Address: ${config.feeAddress}`);
				console.log(`- Fee Percentage: ${config.feePercent}%`);
				console.log(`- Selection Timelock: ${config.selectionTimelock}s`);
				console.log(`- Max Participants: ${config.maxParticipantsPerPond}`);
				console.log(`- Emergency Batch Size: ${config.emergencyBatchSize}`);
			} catch (error) {
				console.warn(`⚠️ Could not verify configuration: ${error.message}`);
			}
		}

		// 2. Deploy PondFactory
		console.log("\n2️⃣ Deploying PondFactory...");
		console.log("📝 PondFactory constructor parameters:");
		console.log(`- 🌟 PondCore Address: ${pondCoreAddress}`);

		try {
			const PondFactory = await ethers.getContractFactory("PondFactory");

			const pondFactory = await PondFactory.deploy(pondCoreAddress, {
				gasLimit: GAS_LIMITS.POND_FACTORY,
			});

			console.log(
				`📤 PondFactory deployment transaction sent: ${
					pondFactory.deploymentTransaction().hash
				}`,
			);
			await pondFactory.waitForDeployment();
			const pondFactoryAddress = await pondFactory.getAddress();

			console.log(`🎉 PondFactory deployed to: ${pondFactoryAddress}`);
			deploymentInfo.pondFactory = pondFactoryAddress;

			// Get the PondCore contract instance
			const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

			// 3. Grant FACTORY_ROLE to PondFactory
			console.log("\n3️⃣ Setting up roles...");

			const factoryRole = await pondCore.FACTORY_ROLE();
			console.log(`🔑 Factory role hash: ${factoryRole}`);

			// Grant role with high gas limit
			const tx1 = await pondCore.grantRole(factoryRole, pondFactoryAddress, {
				gasLimit: GAS_LIMITS.GRANT_ROLE,
			});

			console.log(`📤 Role grant transaction sent: ${tx1.hash}`);
			await tx1.wait();

			console.log(
				`✅ Granted FACTORY_ROLE to PondFactory: ${pondFactoryAddress}`,
			);

			// 4. Save deployment information
			const deployDir = path.join(__dirname, "../deployments");
			if (!fs.existsSync(deployDir)) {
				fs.mkdirSync(deployDir, { recursive: true });
			}

			const timestamp = Math.floor(Date.now() / 1000);
			const deploymentPath = path.join(
				deployDir,
				`${networkName}_${timestamp}.json`,
			);

			fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
			console.log(`\n💾 Deployment information saved to: ${deploymentPath}`);

			// Output important addresses
			console.log("\n=== 🚀 DEPLOYMENT SUMMARY 🚀 ===");
			console.log(`🌐 Network: ${networkName}`);
			console.log(`💼 Fee Address: ${feeAddress}`);
			console.log(`👥 Max Participants: ${maxParticipantsPerPond}`);
			console.log(`🌟 PondCore: ${pondCoreAddress}`);
			if (deploymentInfo.pondFactory) {
				console.log(`🏭 PondFactory: ${deploymentInfo.pondFactory}`);
			} else {
				console.log("🔴 PondFactory: DEPLOYMENT FAILED");
			}
			console.log("==========================");

			// Update the .env file with the deployed contract addresses
			console.log("\n📝 Update your .env file with these values:");
			if (!existingPondCoreAddress) {
				console.log(`${configPrefix}_POND_CORE_ADDRESS=${pondCoreAddress}`);
			}
			if (deploymentInfo.pondFactory) {
				console.log(
					`${configPrefix}_POND_FACTORY_ADDRESS=${deploymentInfo.pondFactory}`,
				);
			}
			console.log(`${configPrefix}_MAX_PARTICIPANTS_PER_POND=${maxParticipantsPerPond}`);

			// Additional deployment notes
			console.log("\n📋 Post-deployment notes:");
			console.log("- Standard ponds can be created through the PondFactory");
			console.log("- Use updateMaxParticipantsPerPond() to adjust limits after deployment");
			console.log("- Monitor ParticipantLimitWarning events for capacity management");
			console.log("- Gas usage will be automatically reported via GasUsageReport events");

		} catch (error) {
			console.error("\n❌ Error during deployment:");
			console.error(error);

			// Try to get more detailed error information
			if (error.transaction) {
				console.log("\n🔍 Transaction that caused the error:");
				console.log(error.transaction);

				try {
					// Try to get transaction receipt for more details
					const receipt = await ethers.provider.getTransactionReceipt(
						error.transactionHash,
					);
					console.log("\n🧾 Transaction receipt:");
					console.log(receipt);
				} catch (receiptError) {
					console.log(
						"❌ Could not get transaction receipt:",
						receiptError.message,
					);
				}
			}

			// Save partial deployment info
			const deployDir = path.join(__dirname, "../deployments");
			if (!fs.existsSync(deployDir)) {
				fs.mkdirSync(deployDir, { recursive: true });
			}

			const timestamp = Math.floor(Date.now() / 1000);
			const deploymentPath = path.join(
				deployDir,
				`${networkName}_${timestamp}_partial.json`,
			);

			deploymentInfo.error = {
				message: error.message,
				stack: error.stack,
			};

			fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
			console.log(
				`\n💾 Partial deployment information saved to: ${deploymentPath}`,
			);

			throw error;
		}

	} catch (factoryError) {
		console.error(`❌ PondFactory deployment failed: ${factoryError.message}`);
		console.error(factoryError);

		// Still save the partial deployment info
		deploymentInfo.factoryError = {
			message: factoryError.message,
			stack: factoryError.stack,
		};
	}
}

main()
	.then(() => process.exit(0))
	.catch((error) => {
		console.error("❌ Deployment error:", error);
		process.exit(1);
	});

	// TESTNET npx hardhat run scripts/deploy.js --network hyperliquid_testnet