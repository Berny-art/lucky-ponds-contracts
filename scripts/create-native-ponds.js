// scripts/create-native-ponds.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("🚀 Starting native ETH pond creation...");

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

	// Load contract addresses from environment
	const distributorAddress = process.env[`${configPrefix}_DISTRIBUTOR_ADDRESS`];
	const pondCoreAddress = process.env[`${configPrefix}_POND_CORE_ADDRESS`];
	const pondFactoryAddress =
		process.env[`${configPrefix}_POND_FACTORY_ADDRESS`];

	// Validate addresses
	if (!distributorAddress || !ethers.isAddress(distributorAddress)) {
		throw new Error(
			`❌ Missing or invalid ${configPrefix}_DISTRIBUTOR_ADDRESS`,
		);
	}

	if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
		throw new Error(`❌ Missing or invalid ${configPrefix}_POND_CORE_ADDRESS`);
	}

	if (!pondFactoryAddress || !ethers.isAddress(pondFactoryAddress)) {
		throw new Error(
			`❌ Missing or invalid ${configPrefix}_POND_FACTORY_ADDRESS`,
		);
	}

	console.log("📋 Contract Addresses:");
	console.log(`- 💼 Distributor: ${distributorAddress}`);
	console.log(`- 🌟 PondCore: ${pondCoreAddress}`);
	console.log(`- 🏭 PondFactory: ${pondFactoryAddress}`);

	// Load configuration parameters
	let minTossPrice, maxTotalTossAmount;
	try {
		minTossPrice = ethers.parseEther(
			process.env[`${configPrefix}_MIN_TOSS_PRICE`] || "0.0001",
		);
		maxTotalTossAmount = ethers.parseEther(
			process.env[`${configPrefix}_MAX_TOTAL_TOSS_AMOUNT`] || "10",
		);
	} catch (error) {
		console.error("⚠️ Error parsing ETH amounts, using defaults");
		minTossPrice = ethers.parseEther("0.0001");
		maxTotalTossAmount = ethers.parseEther("10");
	}

	console.log("\n💰 Pond Configuration:");
	console.log(`- 💰 Min Toss Price: ${ethers.formatEther(minTossPrice)} ETH`);
	console.log(
		`- 💸 Max Total Toss Amount: ${ethers.formatEther(maxTotalTossAmount)} ETH`,
	);

	// Get deployer account
	const [deployer] = await ethers.getSigners();
	console.log(`\n👨‍💻 Using account: ${deployer.address}`);

	// Check deployer balance
	const deployerBalance = await ethers.provider.getBalance(deployer.address);
	console.log(`💎 Balance: ${ethers.formatEther(deployerBalance)} ETH`);

	// Connect to contracts
	try {
		console.log("\n🔌 Connecting to contracts...");

		const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);
		const pondFactory = await ethers.getContractAt(
			"PondFactory",
			pondFactoryAddress,
		);

		// Verify PondFactory has FACTORY_ROLE
		try {
			const factoryRole = await pondCore.FACTORY_ROLE();
			const hasRole = await pondCore.hasRole(factoryRole, pondFactoryAddress);

			if (hasRole) {
				console.log(`✅ PondFactory has FACTORY_ROLE`);
			} else {
				console.warn(
					`⚠️ PondFactory does NOT have FACTORY_ROLE. Granting role...`,
				);

				const tx = await pondCore.grantRole(factoryRole, pondFactoryAddress, {
					gasLimit: 20000000,
				});
				console.log(`📤 Role grant transaction sent: ${tx.hash}`);
				await tx.wait();
				console.log(`✅ FACTORY_ROLE granted to PondFactory`);
			}
		} catch (roleError) {
			console.error(`❌ Error checking/granting role: ${roleError.message}`);
			throw roleError;
		}

		// Define pond periods to create
		console.log("\n🌊 Creating native ETH ponds...");

		// Try creating ponds one by one instead of all at once
		const periodNames = ["Five-Min", "Hourly", "Daily", "Weekly", "Monthly"];
		const pondPeriods = [0, 1, 2, 3, 4]; // Five-min, Hourly, Daily, Weekly, Monthly

		for (let i = 0; i < pondPeriods.length; i++) {
			const period = pondPeriods[i];
			const periodName = periodNames[i];

			console.log(`\n🏊 Creating ${periodName} ETH pond (period ${period})...`);

			try {
				// Create just this pond type with very high gas limit
				const tx = await pondFactory.createStandardPonds(
					ethers.ZeroAddress, // Native ETH
					"ETH",
					minTossPrice,
					maxTotalTossAmount,
					[period], // Just one period at a time
					{
						gasLimit: 10000000, // 10 million gas
					},
				);

				console.log(
					`📤 Create ${periodName} pond transaction sent: ${tx.hash}`,
				);
				await tx.wait();
				console.log(`✅ ${periodName} ETH pond created successfully`);
			} catch (error) {
				console.error(
					`❌ Failed to create ${periodName} ETH pond: ${error.message}`,
				);

				// Try to get more error details
				if (error.transaction) {
					console.log(`🔍 Transaction that failed: ${error.transaction.hash}`);
				}

				// Continue with next pond
				console.log(`⏭️ Continuing with next pond type...`);
			}
		}

		// Check if any ponds were created by checking if they exist
		try {
			console.log("\n🔍 Checking if any ponds were created...");

			const standardTypes = await pondCore.getStandardPondTypes();
			console.log("📊 Standard pond type hashes:");

			for (let i = 0; i < periodNames.length; i++) {
				const typeName = periodNames[i].toLowerCase().replace("-", "");
				const typeHash = standardTypes[i];
				try {
					const pondInfo = await pondCore.getPondStatus(typeHash);
					console.log(`✅ ${periodNames[i]} pond exists: ${pondInfo[0]}`);
				} catch (e) {
					console.log(`❌ ${periodNames[i]} pond does not exist`);
				}
			}
		} catch (checkError) {
			console.error(`❌ Error checking created ponds: ${checkError.message}`);
		}

		console.log("\n🎉 Native ETH pond creation process completed!");
	} catch (error) {
		console.error("\n❌ Error creating native ETH ponds:");
		console.error(error);

		// Save error log
		const logsDir = path.join(__dirname, "../logs");
		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const logPath = path.join(logsDir, `pond_creation_error_${timestamp}.json`);

		const errorLog = {
			timestamp: new Date().toISOString(),
			network: networkName,
			chainId: Number(network.chainId),
			contracts: {
				distributor: distributorAddress,
				pondCore: pondCoreAddress,
				pondFactory: pondFactoryAddress,
			},
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
