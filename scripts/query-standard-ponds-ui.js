const { ethers } = require("hardhat");

async function main() {
    console.log("🔍 Querying Standard Ponds for UI...");

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

    // Configuration - UPDATE THIS VALUE TO THE TOKEN YOU WANT TO QUERY
    // const TOKEN_ADDRESS = "0xC003D79B8a489703b1753711E3ae9fFDFC8d1a82"; // Your ERC20 token
    // Use address(0) or ethers.ZeroAddress for native ETH ponds
    const TOKEN_ADDRESS = ethers.ZeroAddress; // For native ETH

    console.log(`🎯 Querying ponds for token: ${TOKEN_ADDRESS}`);
    
    if (TOKEN_ADDRESS === ethers.ZeroAddress) {
        console.log("💎 Querying Native ETH ponds");
    } else {
        console.log("🪙 Querying ERC20 token ponds");
    }

    try {
        // Connect to PondCore
        const pondCore = await ethers.getContractAt("PondCore", pondCoreAddress);

        console.log("\n🔍 Calling getStandardPondsForUI...");
        
        // Call getStandardPondsForUI for the specified token
        const standardPonds = await pondCore.getStandardPondsForUI(TOKEN_ADDRESS);
        
        console.log(`📊 Found ${standardPonds.length} standard pond definitions`);

        // Parse and display results
        const results = [];
        const periodNames = ["Five-Min", "Hourly", "Daily", "Weekly", "Monthly"];

        console.log("\n📋 Standard Ponds Information:");
        console.log("=".repeat(80));

        for (let i = 0; i < standardPonds.length; i++) {
            const pond = standardPonds[i];
            
            // Safely handle potentially null values
            const pondInfo = {
                index: i,
                name: pond.pondName || "Unknown",
                exists: Boolean(pond.exists),
                pondType: pond.pondType || "0x0000000000000000000000000000000000000000000000000000000000000000",
                period: pond.period ? Number(pond.period) : i,
                periodName: periodNames[pond.period ? Number(pond.period) : i] || `Custom-${i}`,
                pondAddress: pond.pondAddress || ethers.ZeroAddress,
                tokenAddress: pond.tokenAddress || ethers.ZeroAddress,
                startTime: pond.startTime ? Number(pond.startTime) : 0,
                endTime: pond.endTime ? Number(pond.endTime) : 0,
                totalTosses: pond.totalTosses ? Number(pond.totalTosses) : 0,
                totalValue: pond.totalValue || 0n,
                totalParticipants: pond.totalParticipants ? Number(pond.totalParticipants) : 0,
                prizeDistributed: Boolean(pond.prizeDistributed),
                timeUntilEnd: pond.timeUntilEnd ? Number(pond.timeUntilEnd) : 0
            };

            results.push(pondInfo);

            // Display formatted information
            console.log(`\n🏊 ${pondInfo.periodName} Pond (Index ${i}):`);
            console.log(`   📝 Name: ${pondInfo.name}`);
            console.log(`   ✅ Exists: ${pondInfo.exists ? "Yes" : "No"}`);
            console.log(`   🔗 Pond Type Hash: ${pondInfo.pondType}`);
            console.log(`   📅 Period: ${pondInfo.period} (${pondInfo.periodName})`);
            
            if (pondInfo.exists) {
                console.log(`   🏠 Pond Address: ${pondInfo.pondAddress}`);
                console.log(`   🪙 Token Address: ${pondInfo.tokenAddress}`);
                console.log(`   📊 Total Tosses: ${pondInfo.totalTosses}`);
                console.log(`   👥 Participants: ${pondInfo.totalParticipants}`);
                
                try {
                    console.log(`   💰 Total Value: ${ethers.formatEther(pondInfo.totalValue)} tokens`);
                } catch (e) {
                    console.log(`   💰 Total Value: 0 tokens (parsing error)`);
                }
                
                console.log(`   🏆 Prize Distributed: ${pondInfo.prizeDistributed ? "Yes" : "No"}`);
                
                if (pondInfo.timeUntilEnd > 0) {
                    const timeLeft = formatTimeRemaining(pondInfo.timeUntilEnd);
                    console.log(`   ⏰ Time Until End: ${timeLeft}`);
                    console.log(`   📈 Status: Active`);
                } else {
                    console.log(`   📈 Status: Ended`);
                }
                
                if (pondInfo.startTime > 0) {
                    console.log(`   🚀 Start Time: ${new Date(pondInfo.startTime * 1000).toLocaleString()}`);
                }
                if (pondInfo.endTime > 0) {
                    console.log(`   🏁 End Time: ${new Date(pondInfo.endTime * 1000).toLocaleString()}`);
                }
            } else {
                console.log(`   ❌ Pond not created yet`);
            }
        }

        // Summary statistics
        const existingPonds = results.filter(p => p.exists);
        const activePonds = existingPonds.filter(p => p.timeUntilEnd > 0);
        const endedPonds = existingPonds.filter(p => p.timeUntilEnd <= 0);

        console.log("\n" + "=".repeat(80));
        console.log("📊 SUMMARY STATISTICS:");
        console.log("=".repeat(80));
        console.log(`📈 Total Standard Pond Types: ${results.length}`);
        console.log(`✅ Existing Ponds: ${existingPonds.length}`);
        console.log(`🟢 Active Ponds: ${activePonds.length}`);
        console.log(`🔴 Ended Ponds: ${endedPonds.length}`);
        console.log(`❌ Not Created: ${results.length - existingPonds.length}`);

        if (existingPonds.length > 0) {
            try {
                const totalValue = existingPonds.reduce((sum, pond) => {
                    try {
                        return sum + BigInt(pond.totalValue || 0);
                    } catch (e) {
                        return sum;
                    }
                }, 0n);
                const totalTosses = existingPonds.reduce((sum, pond) => sum + pond.totalTosses, 0);
                const totalParticipants = existingPonds.reduce((sum, pond) => sum + pond.totalParticipants, 0);
                
                console.log(`💰 Total Value Across All Ponds: ${ethers.formatEther(totalValue)} tokens`);
                console.log(`🎯 Total Tosses: ${totalTosses}`);
                console.log(`👥 Total Participants: ${totalParticipants}`);
            } catch (e) {
                console.log(`💰 Total Value: Unable to calculate (data parsing error)`);
            }
        }

        // Show which ponds need to be created
        const missingPonds = results.filter(p => !p.exists);
        if (missingPonds.length > 0) {
            console.log("\n🚨 Ponds that need to be created:");
            missingPonds.forEach(pond => {
                console.log(`   - ${pond.periodName} Pond (Period ${pond.period})`);
            });
            console.log("\n💡 Run create-erc20-ponds.js to create missing ponds");
        }

        // Show which ponds need upkeep
        const pondsNeedingUpkeep = existingPonds.filter(p => p.timeUntilEnd <= 0 && !p.prizeDistributed);
        if (pondsNeedingUpkeep.length > 0) {
            console.log("\n⚡ Ponds that need upkeep (winner selection):");
            pondsNeedingUpkeep.forEach(pond => {
                console.log(`   - ${pond.periodName} Pond`);
            });
            console.log("\n💡 Run run-upkeep.js to select winners");
        }

        // Debug: Show raw data for first pond
        if (standardPonds.length > 0) {
            console.log("\n🔍 DEBUG - Raw data for first pond:");
            const rawPond = standardPonds[0];
            console.log("Raw pond object:", rawPond);
            console.log("Raw pond fields:");
            Object.keys(rawPond).forEach(key => {
                console.log(`   ${key}: ${rawPond[key]} (type: ${typeof rawPond[key]})`);
            });
        }

        // Return structured data for programmatic use
        return {
            tokenAddress: TOKEN_ADDRESS,
            network: networkName,
            summary: {
                total: results.length,
                existing: existingPonds.length,
                active: activePonds.length,
                ended: endedPonds.length,
                missing: missingPonds.length
            },
            ponds: results,
            missingPonds: missingPonds.map(p => ({ name: p.periodName, period: p.period })),
            activeUpkeepNeeded: pondsNeedingUpkeep.map(p => ({ name: p.periodName, period: p.period }))
        };

    } catch (error) {
        console.error("\n❌ Error querying standard ponds:");
        console.error(error);
        throw error;
    }
}

// Helper function to format time remaining
function formatTimeRemaining(seconds) {
    if (seconds <= 0) return "Ended";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    let result = "";
    if (days > 0) result += `${days}d `;
    if (hours > 0) result += `${hours}h `;
    result += `${minutes}m`;

    return result;
}

// If running directly, execute main function
if (require.main === module) {
    main()
        .then((result) => {
            console.log("\n✅ Query completed successfully!");
            // You can access the returned data here if needed
            // console.log(JSON.stringify(result, null, 2));
            process.exit(0);
        })
        .catch((error) => {
            console.error("❌ Script error:", error);
            process.exit(1);
        });
}

// Export for use as a module
module.exports = { main, formatTimeRemaining };