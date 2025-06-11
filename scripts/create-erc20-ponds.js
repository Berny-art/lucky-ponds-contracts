// scripts/create-single-erc20-pond.js
const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
	console.log("🚀 Creating ERC20 pond for single token...");

	// ===== CONFIGURATION - EDIT THESE VALUES =====
	const TOKEN_ADDRESS = "0x7DCfFCb06B40344eecED2d1Cbf096B299fE4b405";
	// get decimals from token contract
	const tokenContract = await ethers.getContractAt("IERC20Metadata", TOKEN_ADDRESS);
	if (!tokenContract) {
		throw new Error(`❌ Could not get token contract at address: ${TOKEN_ADDRESS}`);
	}
	const tokenDecimals = await tokenContract.decimals();
	const DECIMALS = tokenDecimals || 18; // Token decimals (6 for BUDDY, 18 for most tokens)
	const MIN_TOSS_PRICE = ethers.parseUnits("0.000002", DECIMALS); // Minimum toss amount (in token units)
	const MAX_TOTAL_TOSS_AMOUNT = ethers.parseUnits("0.0002", DECIMALS); // Maximum total amount per user (in token units)
	
	// Pond types to create (comment out any you don't want)
	const PONDS_TO_CREATE = [
		// { period: 0, name: "Five-Min" },
		// { period: 1, name: "Hourly" },
		{ period: 2, name: "Daily" },
		{ period: 3, name: "Weekly" },
		// { period: 4, name: "Monthly" }
	];
	// ============================================

	// Get network information
	const network = await ethers.provider.getNetwork();
	const networkName = network.name;
	const isTestnet = networkName.includes("testnet") || networkName === "hyperliquid_testnet";
	const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

	console.log(`🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`);
	console.log(`⛓️ Chain ID: ${network.chainId}`);

	// Load contract addresses from environment (these still need to be set)
	const feeAddress = process.env[`${configPrefix}_FEE_ADDRESS`];
	const pondCoreAddress = process.env[`${configPrefix}_POND_CORE_ADDRESS`];
	const pondFactoryAddress = process.env[`${configPrefix}_POND_FACTORY_ADDRESS`];

	// Validate contract addresses
	if (!feeAddress || !ethers.isAddress(feeAddress)) {
		throw new Error(`❌ Missing or invalid ${configPrefix}_FEE_ADDRESS`);
	}

	if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
		throw new Error(`❌ Missing or invalid ${configPrefix}_POND_CORE_ADDRESS`);
	}

	if (!pondFactoryAddress || !ethers.isAddress(pondFactoryAddress)) {
		throw new Error(`❌ Missing or invalid ${configPrefix}_POND_FACTORY_ADDRESS`);
	}

	// Validate token address
	if (!ethers.isAddress(TOKEN_ADDRESS)) {
		throw new Error(`❌ Invalid token address: ${TOKEN_ADDRESS}`);
	}

	console.log("📋 Configuration:");
	console.log(`- 💼 Distributor: ${feeAddress}`);
	console.log(`- 🌟 PondCore: ${pondCoreAddress}`);
	console.log(`- 🏭 PondFactory: ${pondFactoryAddress}`);
	console.log(`- 🪙 Token Address: ${TOKEN_ADDRESS}`);
	console.log(`- 🔢 Token Decimals: ${DECIMALS}`);
	console.log(`- 💰 Min Toss Price: ${ethers.formatUnits(MIN_TOSS_PRICE, DECIMALS)} tokens`);
	console.log(`- 💸 Max Total Toss Amount: ${ethers.formatUnits(MAX_TOTAL_TOSS_AMOUNT, DECIMALS)} tokens`);
	console.log(`- 🏊 Ponds to create: ${PONDS_TO_CREATE.map(p => p.name).join(", ")}`);

	// Get deployer account
	const [deployer] = await ethers.getSigners();
	console.log(`\n👨‍💻 Using account: ${deployer.address}`);

	// Check deployer balance
	const deployerBalance = await ethers.provider.getBalance(deployer.address);
	console.log(`💎 Balance: ${ethers.formatEther(deployerBalance)} ETH`);

	// Gas settings
	const GAS_LIMIT = 15000000; // 15 million gas
	const GAS_PRICE_MULTIPLIER = 1.1; // 10% higher than current gas price

	// Get current gas price and increase it slightly
	const currentGasPrice = await ethers.provider.getFeeData();
	const gasPrice = currentGasPrice.gasPrice
		? ethers.getBigInt(Math.floor(Number(currentGasPrice.gasPrice) * GAS_PRICE_MULTIPLIER))
		: undefined;

	console.log("\n⛽ Gas settings:");
	console.log(`- Gas Limit: ${GAS_LIMIT.toLocaleString()} gas units`);
	if (gasPrice) {
		console.log(`- Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} gwei (${GAS_PRICE_MULTIPLIER}x current)`);
	}

	try {
		console.log("\n🔌 Connecting to contracts...");

		const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);
		const pondFactory = await ethers.getContractAt("PondFactory", pondFactoryAddress);

		// Verify PondFactory has FACTORY_ROLE
		try {
			const factoryRole = await pondCore.FACTORY_ROLE();
			const hasRole = await pondCore.hasRole(factoryRole, pondFactoryAddress);

			if (hasRole) {
				console.log("✅ PondFactory has FACTORY_ROLE");
			} else {
				console.warn("⚠️ PondFactory does NOT have FACTORY_ROLE. Granting role...");
				const tx = await pondCore.grantRole(factoryRole, pondFactoryAddress, {
					gasLimit: 2000000,
				});
				console.log(`📤 Role grant transaction sent: ${tx.hash}`);
				await tx.wait();
				console.log("✅ FACTORY_ROLE granted to PondFactory");
			}
		} catch (roleError) {
			console.error(`❌ Error checking/granting role: ${roleError.message}`);
			throw roleError;
		}

		// Get token symbol
		let tokenSymbol;
		try {
			const tokenContract = await ethers.getContractAt("IERC20Metadata", TOKEN_ADDRESS);
			tokenSymbol = await tokenContract.symbol();
			console.log(`✅ Token symbol: ${tokenSymbol}`);
			
			// Also get token name and decimals for info
			try {
				const tokenName = await tokenContract.name();
				const tokenDecimals = await tokenContract.decimals();
				console.log(`📝 Token name: ${tokenName}`);
				console.log(`🔢 Token decimals: ${tokenDecimals}`);
			} catch (e) {
				// Not critical if we can't get these
			}
		} catch (error) {
			console.warn(`⚠️ Could not get token info: ${error.message}`);
			tokenSymbol = "TOKEN"; // Default fallback
			console.log(`ℹ️ Using default symbol: ${tokenSymbol}`);
		}

		// Check if token is already supported
		let isSupported;
		try {
			isSupported = await pondFactory.isTokenSupported(TOKEN_ADDRESS);
		} catch (error) {
			console.error(`❌ Error checking if token is supported: ${error.message}`);
			isSupported = false;
		}

		// Add token to supported tokens if not already supported
		if (!isSupported) {
			console.log(`🔍 Token ${tokenSymbol} is not yet supported. Adding...`);
			try {
				const addTx = await pondFactory.addSupportedToken(TOKEN_ADDRESS, tokenSymbol, {
					gasLimit: GAS_LIMIT,
					gasPrice: gasPrice,
				});
				console.log(`📤 Add token transaction sent: ${addTx.hash}`);
				await addTx.wait();
				console.log(`✅ Token ${tokenSymbol} added to supported tokens`);
			} catch (error) {
				console.error(`❌ Failed to add token: ${error.message}`);
				throw error;
			}
		} else {
			console.log(`✅ Token ${tokenSymbol} is already supported`);
		}

		// Check which ponds already exist
		console.log(`\n🔍 Checking which ${tokenSymbol} ponds already exist...`);

		const existingPonds = [];
		const missingPonds = [];

		for (const pondConfig of PONDS_TO_CREATE) {
			const pondTypeHash = ethers.keccak256(
				ethers.solidityPacked(
					["string", "address"],
					[`POND_${pondConfig.name.toUpperCase().replace("-", "")}`, TOKEN_ADDRESS],
				),
			);

			try {
				const pondInfo = await pondCore.getPondStatus(pondTypeHash);
				console.log(`✅ ${pondConfig.name} ${tokenSymbol} pond already exists: ${pondInfo[0]}`);
				existingPonds.push(pondConfig);
			} catch (e) {
				console.log(`❓ ${pondConfig.name} ${tokenSymbol} pond does not exist yet`);
				missingPonds.push(pondConfig);
			}
		}

		if (missingPonds.length === 0) {
			console.log(`\n🎉 All requested ${tokenSymbol} ponds already exist!`);
			return;
		}

		console.log(`\n🚀 Will create ${missingPonds.length} missing ${tokenSymbol} ponds...`);

		// Create each missing pond in a separate transaction
		for (const pondConfig of missingPonds) {
			console.log(`\n🏊 Creating ${pondConfig.name} ${tokenSymbol} pond (period ${pondConfig.period})...`);

			try {
				const tx = await pondFactory.createStandardPonds(
					TOKEN_ADDRESS,
					tokenSymbol,
					MIN_TOSS_PRICE,
					MAX_TOTAL_TOSS_AMOUNT,
					[pondConfig.period], // Just one period at a time
					{
						gasLimit: GAS_LIMIT,
						gasPrice: gasPrice,
					},
				);

				console.log(`📤 Create ${pondConfig.name} ${tokenSymbol} pond transaction sent: ${tx.hash}`);

				// Wait for the transaction with a timeout
				const receipt = await Promise.race([
					tx.wait(),
					new Promise((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error("Transaction confirmation timeout - but it might still succeed"),
								),
							90000,
						),
					),
				]);

				console.log(`✅ ${pondConfig.name} ${tokenSymbol} pond created successfully`);
				console.log(`   Gas used: ${receipt.gasUsed.toString()}`);

				// Wait a bit between transactions
				if (missingPonds.length > 1) {
					console.log("⏳ Waiting 3 seconds before next transaction...");
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
			} catch (error) {
				console.error(`❌ Error creating ${pondConfig.name} ${tokenSymbol} pond: ${error.message}`);

				// If it's just a timeout, it might still go through
				if (error.message.includes("timeout")) {
					console.log("⚠️ Transaction may still be processing. Check the explorer!");
				}
				// If it's a serious error, show more details
				else if (error.transaction) {
					console.log(`🔍 Failed transaction: ${error.transaction.hash}`);
				}

				console.log("⏭️ Continuing with next pond...");
			}
		}

		// Verify which ponds were successfully created
		console.log(`\n🔍 Verifying ${tokenSymbol} pond creation results...`);

		let successCount = 0;
		const stillMissing = [];

		for (const pondConfig of missingPonds) {
			const pondTypeHash = ethers.keccak256(
				ethers.solidityPacked(
					["string", "address"],
					[`POND_${pondConfig.name.toUpperCase().replace("-", "")}`, TOKEN_ADDRESS],
				),
			);

			try {
				const pondInfo = await pondCore.getPondStatus(pondTypeHash);
				console.log(`✅ ${pondConfig.name} ${tokenSymbol} pond exists: ${pondInfo[0]}`);
				console.log(`   Pond type hash: ${pondTypeHash}`);
				successCount++;
			} catch (e) {
				console.log(`❌ ${pondConfig.name} ${tokenSymbol} pond still does not exist`);
				stillMissing.push(pondConfig.name);
			}
		}

		// Final summary
		console.log(`\n📊 Creation Summary:`);
		console.log(`   🏆 Successfully created: ${successCount} ponds`);
		console.log(`   ⏸️ Already existed: ${existingPonds.length} ponds`);
		
		if (stillMissing.length > 0) {
			console.log(`   ❌ Failed to create: ${stillMissing.length} ponds (${stillMissing.join(", ")})`);
			console.log("You can run this script again to retry creating the missing ponds.");
		} else {
			console.log(`\n🎉 All ${tokenSymbol} ponds are now available!`);
		}

		// Show pond hashes for reference
		if (successCount > 0 || existingPonds.length > 0) {
			console.log(`\n📋 ${tokenSymbol} Pond Type Hashes:`);
			for (const pondConfig of PONDS_TO_CREATE) {
				const pondTypeHash = ethers.keccak256(
					ethers.solidityPacked(
						["string", "address"],
						[`POND_${pondConfig.name.toUpperCase().replace("-", "")}`, TOKEN_ADDRESS],
					),
				);
				console.log(`   ${pondConfig.name}: ${pondTypeHash}`);
			}
		}

	} catch (error) {
		console.error("\n❌ Error creating ERC20 pond:");
		console.error(error);

		// Save error log
		const logsDir = path.join(__dirname, "../logs");
		if (!fs.existsSync(logsDir)) {
			fs.mkdirSync(logsDir, { recursive: true });
		}

		const timestamp = Math.floor(Date.now() / 1000);
		const logPath = path.join(logsDir, `single_erc20_pond_error_${timestamp}.json`);

		const errorLog = {
			timestamp: new Date().toISOString(),
			network: networkName,
			chainId: Number(network.chainId),
			configuration: {
				tokenAddress: TOKEN_ADDRESS,
				minTossPrice: MIN_TOSS_PRICE.toString(),
				maxTotalTossAmount: MAX_TOTAL_TOSS_AMOUNT.toString(),
				pondsToCreate: PONDS_TO_CREATE,
			},
			contracts: {
				distributor: feeAddress,
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

// TESTNET: npx hardhat run scripts/create-erc20-ponds.js --network hyperliquid_testnet
// MAINNET: npx hardhat run scripts/create-erc20-ponds.js --network hyperliquid_mainnet
