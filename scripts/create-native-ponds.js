// scripts/create-all-ponds-safely.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("🚀 Starting native ETH pond creation (safe mode)...");
	console.log(
		"This script will attempt to create ALL pond types with optimized gas settings",
	);

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
	let minTossPrice;
	let maxTotalTossAmount;
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
				console.log("✅ PondFactory has FACTORY_ROLE");
			} else {
				console.warn(
					"⚠️ PondFactory does NOT have FACTORY_ROLE. Granting role...",
				);

				const tx = await pondCore.grantRole(factoryRole, pondFactoryAddress, {
					gasLimit: 20000000,
				});
				console.log(`📤 Role grant transaction sent: ${tx.hash}`);
				await tx.wait();
				console.log("✅ FACTORY_ROLE granted to PondFactory");
			}
		} catch (roleError) {
			console.error(`❌ Error checking/granting role: ${roleError.message}`);
			throw roleError;
		}

		// Define pond periods to create
		console.log("\n🌊 Creating native ETH ponds...");

		// Define the pond types
		const periodNames = ["Five-Min", "Hourly", "Daily", "Weekly", "Monthly"];
		const pondPeriods = [0, 1, 2, 3, 4]; // Five-min, Hourly, Daily, Weekly, Monthly

		// Get current standard pond types to check which ones already exist
		console.log("\n🔍 Checking which ponds already exist...");
		const standardTypes = await pondCore.getStandardPondTypes();

		const existingPonds = [];
		const missingPonds = [];

		for (let i = 0; i < periodNames.length; i++) {
			const typeName = periodNames[i];
			const typeHash = standardTypes[i];
			try {
				const pondInfo = await pondCore.getPondStatus(typeHash);
				console.log(`✅ ${typeName} pond already exists: ${pondInfo[0]}`);
				existingPonds.push(i);
			} catch (e) {
				console.log(`❓ ${typeName} pond does not exist yet`);
				missingPonds.push(i);
			}
		}

		if (missingPonds.length === 0) {
			console.log("\n🎉 All ponds already exist! Nothing to do.");
			return;
		}

		console.log(
			`\n🚀 Will attempt to create ${missingPonds.length} missing ponds...`,
		);

		// Gas settings - can be adjusted if needed
		const GAS_LIMIT = 15000000; // 15 million gas
		const GAS_PRICE_MULTIPLIER = 1.1; // 10% higher than current gas price

		// Get current gas price and increase it slightly for better chances
		const currentGasPrice = await ethers.provider.getFeeData();
		const gasPrice = currentGasPrice.gasPrice
			? ethers.getBigInt(
					Math.floor(Number(currentGasPrice.gasPrice) * GAS_PRICE_MULTIPLIER),
				)
			: undefined;

		console.log("\n⛽ Using increased gas settings:");
		console.log(`- Gas Limit: ${GAS_LIMIT.toLocaleString()} gas units`);
		if (gasPrice) {
			console.log(
				`- Gas Price: ${ethers.formatUnits(
					gasPrice,
					"gwei",
				)} gwei (${GAS_PRICE_MULTIPLIER}x current)`,
			);
		}

		// Create each missing pond in a separate transaction
		for (const pondIndex of missingPonds) {
			const period = pondPeriods[pondIndex];
			const periodName = periodNames[pondIndex];

			console.log(`\n🏊 Creating ${periodName} ETH pond (period ${period})...`);

			try {
				// Create this pond type with high gas settings
				const tx = await pondFactory.createStandardPonds(
					ethers.ZeroAddress, // Native ETH
					"ETH",
					minTossPrice,
					maxTotalTossAmount,
					[period], // Just one period at a time
					{
						gasLimit: GAS_LIMIT,
						gasPrice: gasPrice, // Use our calculated higher gas price
					},
				);

				console.log(
					`📤 Create ${periodName} pond transaction sent: ${tx.hash}`,
				);

				// Wait for the transaction with a timeout
				const receipt = await Promise.race([
					tx.wait(),
					new Promise((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error(
										"Transaction confirmation timeout - but it might still succeed",
									),
								),
							90000,
						),
					),
				]);

				console.log(`✅ ${periodName} ETH pond created successfully`);

				// Wait a bit between transactions to let the network breathe
				console.log("⏳ Waiting 3 seconds before next transaction...");
				await new Promise((resolve) => setTimeout(resolve, 3000));
			} catch (error) {
				console.error(`❌ Error with ${periodName} ETH pond: ${error.message}`);

				// If it's just a timeout, it might still go through
				if (error.message.includes("timeout")) {
					console.log(
						"⚠️ Transaction may still be processing. Check the explorer!",
					);
				}
				// If it's a serious error, show more details
				else if (error.transaction) {
					console.log(`🔍 Transaction that failed: ${error.transaction.hash}`);
				}

				console.log("⏭️ Continuing with next pond type...");
			}
		}

		// Verify which ponds were successfully created
		try {
			console.log("\n🔍 Verifying pond creation results...");

			let successCount = 0;
			const stillMissing = [];

			for (const pondIndex of missingPonds) {
				const periodName = periodNames[pondIndex];
				const typeHash = standardTypes[pondIndex];

				try {
					const pondInfo = await pondCore.getPondStatus(typeHash);
					console.log(`✅ ${periodName} pond exists: ${pondInfo[0]}`);
					successCount++;
				} catch (e) {
					console.log(`❌ ${periodName} pond still does not exist`);
					stillMissing.push(periodName);
				}
			}

			if (successCount === missingPonds.length) {
				console.log("\n🎉 All ponds were created successfully!");
			} else {
				console.log(
					`\n⚠️ Created ${successCount} out of ${missingPonds.length} missing ponds.`,
				);
				console.log(`Still missing: ${stillMissing.join(", ")}`);
				console.log(
					"You can run this script again to attempt creating the remaining ponds.",
				);
			}
		} catch (checkError) {
			console.error(`❌ Error checking created ponds: ${checkError.message}`);
		}

		console.log("\n🏁 Native ETH pond creation process completed!");
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
