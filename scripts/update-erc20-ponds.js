const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
    console.log("🔧 Starting pond settings update process for all ERC20 ponds...");

    // Get network information
    const network = await ethers.provider.getNetwork();
    const networkName = network.name;
    const isTestnet =
        networkName.includes("testnet") || networkName === "hyperliquid_testnet";
    const configPrefix = isTestnet ? "TESTNET" : "MAINNET";

    console.log(
        `🌐 Network: ${networkName} (${isTestnet ? "🧪 Testnet" : "🔴 Mainnet"})`,
    );

    // Load contract addresses from environment
    const pondCoreAddress = process.env[`${configPrefix}_POND_CORE_ADDRESS`];

    if (!pondCoreAddress || !ethers.isAddress(pondCoreAddress)) {
        throw new Error(`❌ Missing or invalid ${configPrefix}_POND_CORE_ADDRESS`);
    }

    console.log(`📋 PondCore Address: ${pondCoreAddress}`);

    // Configuration - UPDATE THESE VALUES
    const TOKEN_ADDRESS = "0xC003D79B8a489703b1753711E3ae9fFDFC8d1a82"; // Your ERC20 token
    const NEW_MIN_TOSS = ethers.parseEther("5.0");
    const NEW_MAX_TOTAL = ethers.parseEther("50.0");

    console.log("\n🎯 Update Configuration:");
    console.log(`- Token Address: ${TOKEN_ADDRESS}`);
    console.log(`- New Min Toss: ${ethers.formatEther(NEW_MIN_TOSS)} tokens`);
    console.log(`- New Max Total: ${ethers.formatEther(NEW_MAX_TOTAL)} tokens`);

    // Get deployer account
    const [deployer] = await ethers.getSigners();
    console.log(`\n👨‍💻 Using account: ${deployer.address}`);

    // Check deployer balance
    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    console.log(`💎 Balance: ${ethers.formatEther(deployerBalance)} ETH`);

    try {
        // Connect to PondCore
        const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

        console.log("\n🔍 Getting standard pond types for this token...");
        
        // Use getStandardPondsForUI to get the correct pond types for this token
        const standardPonds = await pondCore.getStandardPondsForUI(TOKEN_ADDRESS);
        
        console.log(`📊 Found ${standardPonds.length} standard pond types to check`);

        const existingPonds = [];
        const updatedPonds = [];
        const failedUpdates = [];

        // Check which standard ponds actually exist
        console.log("\n🔍 Checking which ponds exist...");
        
        for (let i = 0; i < standardPonds.length; i++) {
            const pondInfo = standardPonds[i];
            const pondType = pondInfo.pondType;
            const pondName = pondInfo.pondName;
            const exists = pondInfo.exists;

            console.log(`🔍 Checking ${pondName} with hash: ${pondType}`);

            if (!exists) {
                console.log(`❌ ${pondName} pond does not exist`);
                continue;
            }

            // Additional safety check for valid pond type hash
            if (!pondType || pondType === "0x0000000000000000000000000000000000000000000000000000000000000000") {
                console.log(`❌ ${pondName} has invalid pond type hash`);
                continue;
            }

            try {
                // Get current pond status (contains settings in positions 8 and 9)
                const pondStatus = await pondCore.getPondStatus(pondType);
                
                // Safety check for valid pond address
                if (!pondStatus[0] || pondStatus[0] === ethers.ZeroAddress) {
                    console.log(`⚠️ ${pondName} exists but has zero address - might be a configuration issue`);
                    // Still continue as the pond type might be valid for settings update
                }
                
                // Extract settings from getPondStatus return values
                // Position 8: minTossPrice, Position 9: maxTotalTossAmount
                const currentMinToss = pondStatus[8] || 0n;
                const currentMaxTotal = pondStatus[9] || 0n;
                
                existingPonds.push({
                    name: pondName,
                    period: pondInfo.period || i,
                    hash: pondType,
                    address: pondStatus[0] || ethers.ZeroAddress,
                    currentMinToss: currentMinToss,
                    currentMaxTotal: currentMaxTotal,
                    // Note: feePercentage and timelock positions would need to be identified in pondStatus array
                    feePercentage: 0, // Placeholder - would need correct position from contract
                    timelock: 0 // Placeholder - would need correct position from contract
                });

                console.log(`✅ ${pondName} exists - Min: ${ethers.formatEther(currentMinToss)}, Max: ${ethers.formatEther(currentMaxTotal)}`);
                console.log(`   📍 Pond Address: ${pondStatus[0]}`);
                
            } catch (e) {
                console.log(`❌ Error getting ${pondName} pond details: ${e.message}`);
                console.log(`   🔍 Trying to use pond type hash anyway: ${pondType}`);
                
                // If getPondStatus fails but we have a valid hash, still try to update settings
                if (pondType && pondType !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
                    try {
                        // Try to get pond status which contains settings
                        const pondStatus = await pondCore.getPondStatus(pondType);
                        const currentMinToss = pondStatus[8] || 0n;
                        const currentMaxTotal = pondStatus[9] || 0n;
                        
                        existingPonds.push({
                            name: pondName,
                            period: pondInfo.period || i,
                            hash: pondType,
                            address: ethers.ZeroAddress,
                            currentMinToss: currentMinToss,
                            currentMaxTotal: currentMaxTotal,
                            feePercentage: 0,
                            timelock: 0
                        });
                        console.log(`✅ ${pondName} settings retrieved - Min: ${ethers.formatEther(currentMinToss)}, Max: ${ethers.formatEther(currentMaxTotal)}`);
                    } catch (settingsError) {
                        console.log(`❌ Could not get settings for ${pondName}: ${settingsError.message}`);
                    }
                }
            }
        }

        if (existingPonds.length === 0) {
            console.log("\n⚠️ No ponds found for this token. Please create them first using create-erc20-ponds.js");
            return;
        }

        console.log(`\n🎯 Found ${existingPonds.length} existing ponds. Proceeding with updates...`);

        // Update each existing pond
        for (const pond of existingPonds) {
            console.log(`\n🔧 Updating ${pond.name}...`);
            
            try {
                // Check if update is actually needed
                if (pond.currentMinToss === NEW_MIN_TOSS && pond.currentMaxTotal === NEW_MAX_TOTAL) {
                    console.log(`⏭️ ${pond.name} already has the correct settings, skipping...`);
                    continue;
                }

                // Need to estimate gas for both transactions
                let totalGasEstimate = 0n;
                let minTossGasEstimate = 0n;
                let maxTotalGasEstimate = 0n;
                
                // Only estimate gas for updates that are actually needed
                if (pond.currentMinToss !== NEW_MIN_TOSS) {
                    minTossGasEstimate = await pondCore.updateMinTossPrice.estimateGas(
                        pond.hash,
                        NEW_MIN_TOSS,
                    );
                    totalGasEstimate += minTossGasEstimate;
                }
                
                if (pond.currentMaxTotal !== NEW_MAX_TOTAL) {
                    maxTotalGasEstimate = await pondCore.updateMaxTotalTossAmount.estimateGas(
                        pond.hash,
                        NEW_MAX_TOTAL,
                    );
                    totalGasEstimate += maxTotalGasEstimate;
                }

                const gasPrice = (await ethers.provider.getFeeData()).gasPrice;
                const gasCost = totalGasEstimate * gasPrice;

                console.log(`⛽ Gas estimate: ${totalGasEstimate.toLocaleString()} units (${ethers.formatEther(gasCost)} ETH)`);

                // Update min toss price if needed
                if (pond.currentMinToss !== NEW_MIN_TOSS) {
                    console.log(`🔧 Updating min toss price from ${ethers.formatEther(pond.currentMinToss)} to ${ethers.formatEther(NEW_MIN_TOSS)}...`);
                    const minTossTx = await pondCore.updateMinTossPrice(
                        pond.hash,
                        NEW_MIN_TOSS,
                        {
                            gasLimit: minTossGasEstimate + minTossGasEstimate / 5n, // Add 20% buffer
                        },
                    );
                    
                    console.log(`📝 Min toss transaction: ${minTossTx.hash}`);
                    console.log("⏳ Waiting for confirmation...");
                    
                    await minTossTx.wait();
                    console.log(`✅ Min toss price updated`);
                    
                    // Wait 1 second between transactions
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }

                // Update max total toss amount if needed
                if (pond.currentMaxTotal !== NEW_MAX_TOTAL) {
                    console.log(`🔧 Updating max total from ${ethers.formatEther(pond.currentMaxTotal)} to ${ethers.formatEther(NEW_MAX_TOTAL)}...`);
                    const maxTotalTx = await pondCore.updateMaxTotalTossAmount(
                        pond.hash,
                        NEW_MAX_TOTAL,
                        {
                            gasLimit: maxTotalGasEstimate + maxTotalGasEstimate / 5n, // Add 20% buffer
                        },
                    );
                    
                    console.log(`📝 Max total transaction: ${maxTotalTx.hash}`);
                    console.log("⏳ Waiting for confirmation...");
                    
                    const receipt = await maxTotalTx.wait();
                    console.log(`✅ Max total amount updated in block ${receipt.blockNumber}`);
                }

                // Wait 2 seconds between updates to avoid overwhelming the network
                console.log("⏳ Waiting 2 seconds before next update...");
                await new Promise((resolve) => setTimeout(resolve, 2000));

            } catch (error) {
                console.error(`❌ Failed to update ${pond.name}: ${error.message}`);
                failedUpdates.push({
                    name: pond.name,
                    error: error.message
                });
                
                // Continue with other ponds even if one fails
                console.log("⏭️ Continuing with next pond...");
            }
        }

        // Summary report
        console.log("\n📊 Update Summary:");
        console.log(`- Total ponds found: ${existingPonds.length}`);
        console.log(`- Successfully updated: ${updatedPonds.length}`);
        console.log(`- Failed updates: ${failedUpdates.length}`);

        if (updatedPonds.length > 0) {
            console.log("\n✅ Successfully updated ponds:");
            updatedPonds.forEach(pond => {
                console.log(`  - ${pond.name}: Min ${pond.newMinToss}, Max ${pond.newMaxTotal} (${pond.txHash})`);
            });
        }

        if (failedUpdates.length > 0) {
            console.log("\n❌ Failed updates:");
            failedUpdates.forEach(pond => {
                console.log(`  - ${pond.name}: ${pond.error}`);
            });
        }

        // Save detailed log
        const logsDir = path.join(__dirname, "../logs");
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const logPath = path.join(
            logsDir,
            `bulk_pond_settings_update_${timestamp}.json`,
        );

        const updateLog = {
            timestamp: new Date().toISOString(),
            network: networkName,
            chainId: Number(network.chainId),
            pondCore: pondCoreAddress,
            tokenAddress: TOKEN_ADDRESS,
            newSettings: {
                minToss: ethers.formatEther(NEW_MIN_TOSS),
                maxTotal: ethers.formatEther(NEW_MAX_TOTAL)
            },
            summary: {
                totalPonds: existingPonds.length,
                successfulUpdates: updatedPonds.length,
                failedUpdates: failedUpdates.length
            },
            updatedPonds: updatedPonds,
            failedUpdates: failedUpdates,
            existingPonds: existingPonds.map(pond => ({
                name: pond.name,
                address: pond.address,
                hash: pond.hash,
                previousSettings: {
                    minToss: ethers.formatEther(pond.currentMinToss),
                    maxTotal: ethers.formatEther(pond.currentMaxTotal),
                    feePercentage: pond.feePercentage.toString(),
                    timelock: pond.timelock.toString()
                }
            }))
        };

        fs.writeFileSync(logPath, JSON.stringify(updateLog, null, 2));
        console.log(`\n💾 Detailed log saved to: ${logPath}`);

        if (updatedPonds.length === existingPonds.length) {
            console.log("\n🎉 All pond settings updated successfully!");
        } else if (updatedPonds.length > 0) {
            console.log("\n⚠️ Some ponds were updated successfully, but some failed. Check the log for details.");
        } else {
            console.log("\n❌ No ponds were updated. Check the errors above.");
        }

    } catch (error) {
        console.error("\n❌ Error updating pond settings:");
        console.error(error);

        // Save error log
        const logsDir = path.join(__dirname, "../logs");
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const timestamp = Math.floor(Date.now() / 1000);
        const logPath = path.join(logsDir, `bulk_pond_update_error_${timestamp}.json`);

        const errorLog = {
            timestamp: new Date().toISOString(),
            network: networkName,
            chainId: Number(network.chainId),
            pondCore: pondCoreAddress,
            tokenAddress: TOKEN_ADDRESS,
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