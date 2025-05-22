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

	// Load configuration based on network
	const hyperFrogsV2Address =
		process.env[`${configPrefix}_HYPERFROGS_V2_ADDRESS`];
	const unmigratedClaimAddress =
		process.env[`${configPrefix}_UNMIGRATED_CLAIM_ADDRESS`];
	const existingDistributorAddress =
		process.env[`${configPrefix}_DISTRIBUTOR_ADDRESS`];
	const existingPondCoreAddress =
		process.env[`${configPrefix}_POND_CORE_ADDRESS`];
	const createStandardPonds =
		process.env[`${configPrefix}_CREATE_STANDARD_PONDS`] === "true";

	// Handle decimal conversion more safely for ETH amounts
	let minTossPrice;
	let maxTotalTossAmount;
	try {
		minTossPrice = ethers.parseEther(
			process.env[`${configPrefix}_MIN_TOSS_PRICE`],
		);
		maxTotalTossAmount = ethers.parseEther(
			process.env[`${configPrefix}_MAX_TOTAL_TOSS_AMOUNT`],
		);
	} catch (error) {
		console.error("⚠️ Error parsing ETH amounts, using defaults");
		minTossPrice = ethers.parseEther("0.0001");
		maxTotalTossAmount = ethers.parseEther("10");
	}

	const minFrogsRequired = Number.parseInt(
		process.env[`${configPrefix}_MIN_FROGS_REQUIRED`] || "5",
	);
	const selectionTimelock = Number.parseInt(
		process.env[`${configPrefix}_SELECTION_TIMELOCK`] || "60",
	);
	const feePercentage = Number.parseInt(
		process.env[`${configPrefix}_FEE_PERCENTAGE`] || "7",
	);

	// Validate key configuration
	if (!hyperFrogsV2Address)
		throw new Error(`❌ Missing ${configPrefix}_HYPERFROGS_V2_ADDRESS`);
	if (!unmigratedClaimAddress)
		throw new Error(`❌ Missing ${configPrefix}_UNMIGRATED_CLAIM_ADDRESS`);

	console.log("📋 Configuration loaded:");
	console.log(`- 🐸 HyperFrogs V2: ${hyperFrogsV2Address}`);
	console.log(`- 🏦 Unmigrated Claim Address: ${unmigratedClaimAddress}`);
	console.log(`- 💰 Min Toss Price: ${ethers.formatEther(minTossPrice)} ETH`);
	console.log(
		`- 💸 Max Total Toss Amount: ${ethers.formatEther(maxTotalTossAmount)} ETH`,
	);
	console.log(`- 🔢 Min Frogs Required: ${minFrogsRequired}`);
	console.log(`- ⏱️ Selection Timelock: ${selectionTimelock} seconds`);
	console.log(`- 💹 Fee Percentage: ${feePercentage}%`);
	console.log(
		`- 🌊 Create Standard Ponds: ${createStandardPonds ? "✅ Yes" : "❌ No"}`,
	);

	if (existingDistributorAddress) {
		console.log(
			`- 💼 Using existing Distributor: ${existingDistributorAddress}`,
		);
	}

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

	// Define gas limits for complex contracts (customize as needed)
	const GAS_LIMITS = {
		FEE_DISTRIBUTOR: 10000000,
		POND_CORE: 15000000,
		POND_FACTORY: 15000000,
		GRANT_ROLE: 10000000,
		CREATE_PONDS: 20000000,
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
		hyperFrogsV2: hyperFrogsV2Address,
		unmigratedClaimAddress: unmigratedClaimAddress,
	};

	try {
		// Determine fee distributor address - use existing or deploy new
		let feeDistributorAddress;

		if (
			existingDistributorAddress &&
			ethers.isAddress(existingDistributorAddress)
		) {
			console.log("\n🔄 Using existing PondFeeDistributor from .env file");
			feeDistributorAddress = existingDistributorAddress;
			deploymentInfo.pondFeeDistributor = feeDistributorAddress;
			console.log(`📍 PondFeeDistributor address: ${feeDistributorAddress}`);

			// Verify the contract exists
			try {
				const code = await ethers.provider.getCode(feeDistributorAddress);
				if (code === "0x") {
					console.warn(
						`⚠️ WARNING: No contract code found at the provided distributor address: ${feeDistributorAddress}`,
					);
					console.warn(
						"Will continue anyway, but this might cause issues later.",
					);
				} else {
					console.log("✅ Contract verified at address");
				}
			} catch (error) {
				console.warn(
					`⚠️ WARNING: Error checking contract code at distributor address: ${error.message}`,
				);
			}
		} else {
			// 1. Deploy PondFeeDistributor first
			console.log("\n1️⃣ Deploying PondFeeDistributor...");

			const gasReserve = ethers.parseEther("0.01"); // Reserve 0.01 ETH for gas
			const initialClaimPeriod = 7 * 24 * 60 * 60; // 7 days in seconds

			// Log contract parameters for debugging
			console.log("📝 PondFeeDistributor constructor parameters:");
			console.log(`- 🐸 NFT Contract: ${hyperFrogsV2Address}`);
			console.log(`- 🏦 Project Wallet: ${unmigratedClaimAddress}`);
			console.log(`- ⛽ Gas Reserve: ${ethers.formatEther(gasReserve)} ETH`);
			console.log(`- 🔢 Min NFTs Required: ${minFrogsRequired}`);
			console.log(`- ⏱️ Initial Claim Period: ${initialClaimPeriod} seconds`);

			const PondFeeDistributor =
				await ethers.getContractFactory("PondFeeDistributor");

			// Deploy with high gas limit
			const feeDistributor = await PondFeeDistributor.deploy(
				hyperFrogsV2Address,
				unmigratedClaimAddress,
				gasReserve,
				minFrogsRequired,
				initialClaimPeriod,
				{ gasLimit: GAS_LIMITS.FEE_DISTRIBUTOR },
			);

			console.log(
				`📤 PondFeeDistributor deployment transaction sent: ${
					feeDistributor.deploymentTransaction().hash
				}`,
			);
			await feeDistributor.waitForDeployment();
			feeDistributorAddress = await feeDistributor.getAddress();

			console.log(
				`🎉 PondFeeDistributor deployed to: ${feeDistributorAddress}`,
			);
			deploymentInfo.pondFeeDistributor = feeDistributorAddress;
		}

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

			// Verify key parameters
			try {
				const actualFeeAddress = await pondCore.feeAddress();
				if (
					actualFeeAddress.toLowerCase() !== feeDistributorAddress.toLowerCase()
				) {
					console.warn(
						`⚠️ WARNING: PondCore fee address (${actualFeeAddress}) does not match provided distributor address (${feeDistributorAddress})`,
					);
				} else {
					console.log("✅ PondCore fee address matches distributor address");
				}
			} catch (error) {
				console.warn(
					`⚠️ WARNING: Error verifying PondCore parameters: ${error.message}`,
				);
			}
		} else {
			// 2. Deploy PondCore using PondFeeDistributor as fee address
			console.log("\n2️⃣ Deploying PondCore...");
			console.log("📝 PondCore constructor parameters:");
			console.log(`- 💼 Fee Address: ${feeDistributorAddress}`);
			console.log(`- 💹 Fee Percentage: ${feePercentage}`);
			console.log(`- ⏱️ Selection Timelock: ${selectionTimelock} seconds`);

			const PondCore = await ethers.getContractFactory("PondCore");

			// Deploy with high gas limit for complex contract
			const pondCore = await PondCore.deploy(
				feeDistributorAddress,
				feePercentage,
				selectionTimelock,
				{ gasLimit: GAS_LIMITS.POND_CORE },
			);

			console.log(
				`📤 PondCore deployment transaction sent: ${
					pondCore.deploymentTransaction().hash
				}`,
			);
			await pondCore.waitForDeployment();
			pondCoreAddress = await pondCore.getAddress();

			console.log(`🎉 PondCore deployed to: ${pondCoreAddress}`);
			deploymentInfo.pondCore = pondCoreAddress;
		}

		// 3. Deploy PondFactory
		console.log("\n3️⃣ Deploying PondFactory...");
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

			// 4. Grant FACTORY_ROLE to PondFactory
			console.log("\n4️⃣ Setting up roles...");

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

			// 5. Save deployment information
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
			console.log(`💼 PondFeeDistributor: ${feeDistributorAddress}`);
			console.log(`🌟 PondCore: ${pondCoreAddress}`);
			if (deploymentInfo.pondFactory) {
				console.log(`🏭 PondFactory: ${deploymentInfo.pondFactory}`);
			} else {
				console.log("🔴 PondFactory: DEPLOYMENT FAILED");
			}
			console.log("==========================");

			// Update the .env file with the deployed contract addresses
			console.log("\n📝 Update your .env file with these values:");
			if (!existingDistributorAddress) {
				console.log(
					`${configPrefix}_DISTRIBUTOR_ADDRESS=${feeDistributorAddress}`,
				);
			}
			if (!existingPondCoreAddress) {
				console.log(`${configPrefix}_POND_CORE_ADDRESS=${pondCoreAddress}`);
			}
			if (deploymentInfo.pondFactory) {
				console.log(
					`${configPrefix}_POND_FACTORY_ADDRESS=${deploymentInfo.pondFactory}`,
				);
			}
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
		// 5. Create standard ponds if enabled
		if (createStandardPonds) {
			console.log("\n5️⃣ Creating standard ponds...");

			// Define pond periods to create (all standard periods)
			const pondPeriods = [0, 1, 2, 3, 4]; // Five-min, Hourly, Daily, Weekly, Monthly

			// Create native ETH ponds
			console.log("🌊 Creating native ETH ponds...");

			try {
				// Create ponds with high gas limit
				const tx2 = await pondFactory.createStandardPonds(
					ethers.ZeroAddress, // Native ETH
					"ETH",
					minTossPrice,
					maxTotalTossAmount,
					pondPeriods,
					{
						gasLimit: GAS_LIMITS.CREATE_PONDS,
					},
				);

				console.log(`📤 Create standard ponds transaction sent: ${tx2.hash}`);
				await tx2.wait();
				console.log("✅ ETH ponds created successfully");
			} catch (error) {
				console.error(`❌ Failed to create ETH ponds: ${error.message}`);
				// Continue with other tokens even if ETH ponds fail
			}

			// Create ERC20 token ponds if any tokens are specified
			const defaultTokensEnv = process.env[`${configPrefix}_DEFAULT_TOKENS`];
			if (defaultTokensEnv) {
				const defaultTokens = defaultTokensEnv.split(",");
				console.log(
					`🪙 Found ${defaultTokens.length} tokens to set up ponds for`,
				);

				for (const tokenAddress of defaultTokens) {
					// Get token symbol (try with error handling)
					let symbol = "TOKEN";
					try {
						const tokenContract = await ethers.getContractAt(
							"IERC20Metadata",
							tokenAddress,
						);
						symbol = await tokenContract.symbol();
					} catch (error) {
						console.warn(
							`⚠️ Could not get symbol for token ${tokenAddress}, using default`,
						);
					}

					console.log(`🪙 Creating ponds for ${symbol} (${tokenAddress})...`);

					try {
						// Register token with high gas limit
						const tx3 = await pondFactory.addSupportedToken(
							tokenAddress,
							symbol,
							{
								gasLimit: GAS_LIMITS.GRANT_ROLE,
							},
						);

						console.log(`📤 Register token transaction sent: ${tx3.hash}`);
						await tx3.wait();

						// Create token ponds with high gas limit
						const tx4 = await pondFactory.createStandardPonds(
							tokenAddress,
							symbol,
							minTossPrice,
							maxTotalTossAmount,
							pondPeriods,
							{
								gasLimit: GAS_LIMITS.CREATE_PONDS,
							},
						);

						console.log(`📤 Create token ponds transaction sent: ${tx4.hash}`);
						await tx4.wait();
						console.log(`✅ ${symbol} ponds created successfully`);
					} catch (error) {
						console.error(
							`❌ Failed to create ponds for ${symbol}: ${error.message}`,
						);
						// Continue with other tokens
					}
				}
			}
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
