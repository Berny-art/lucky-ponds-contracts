const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("PondCore Winner Selection Debug", function () {
  let pondCore;
  let owner, addr1, addr2, addr3, addr4, addr5;
  let pondType;

  beforeEach(async function () {
    [owner, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();

    // Deploy PondCore with shorter timelock for testing
    const PondCore = await ethers.getContractFactory("PondCore");
    pondCore = await PondCore.deploy(
      owner.address, // fee address
      5, // 5% fee
      60, // 1 minute timelock (instead of 5 minutes)
      1000 // max participants
    );

    // Grant FACTORY_ROLE to owner for testing
    const FACTORY_ROLE = await pondCore.FACTORY_ROLE();
    await pondCore.grantRole(FACTORY_ROLE, owner.address);

    // Create a test pond
    const currentTime = await time.latest();
    pondType = ethers.keccak256(ethers.toUtf8Bytes("TEST_POND"));
    
    await pondCore.createPond(
      pondType,
      "Test Pond",
      currentTime,
      currentTime + 3600, // 1 hour duration
      ethers.parseEther("0.01"), // min toss
      ethers.parseEther("1.0"), // max total toss
      0, // TokenType.NATIVE
      ethers.ZeroAddress,
      5 // PondPeriod.CUSTOM
    );
  });

  describe("Debug Winner Selection Issue", function () {
    it("Should reproduce the winner selection error", async function () {
      console.log("=== REPRODUCING WINNER SELECTION ERROR ===");

      // Add multiple participants with tosses
      const participants = [addr1, addr2, addr3, addr4, addr5];
      const tossAmounts = [
        ethers.parseEther("0.1"),
        ethers.parseEther("0.2"),
        ethers.parseEther("0.15"),
        ethers.parseEther("0.3"),
        ethers.parseEther("0.25")
      ];

      // Make tosses
      for (let i = 0; i < participants.length; i++) {
        console.log(`Participant ${i + 1} tossing ${ethers.formatEther(tossAmounts[i])} ETH`);
        await pondCore.connect(participants[i]).toss(pondType, 0, { 
          value: tossAmounts[i] 
        });
      }

      // Check pond data before selection
      console.log("\n=== POND DATA BEFORE SELECTION ===");
      const debugData = await pondCore.debugPondData(pondType);
      console.log("Total Tosses:", debugData.totalTosses.toString());
      console.log("Total Frog Value:", ethers.formatEther(debugData.totalFrogValue));
      console.log("Participant Count:", debugData.participantCount.toString());
      console.log("Tosses Array Length:", debugData.tossesArrayLength.toString());
      console.log("Data Consistent:", debugData.dataConsistent);

      // Get pond status
      const status = await pondCore.getPondStatus(pondType);
      console.log("Pond Total Value:", ethers.formatEther(status.totalValue));
      console.log("Pond End Time:", new Date(Number(status.endTime) * 1000).toISOString());

      // Wait for pond to end + timelock period
      const pond = await pondCore.ponds(pondType);
      const config = await pondCore.getConfig();
      const timelock = config.selectionTimelock;
      
      console.log("Current timelock setting:", timelock.toString(), "seconds");
      console.log("Pond period:", pond.period.toString()); // Should be 5 (CUSTOM)
      
      // Calculate effective timelock (5-min ponds have reduced timelock)
      const effectiveTimelock = pond.period === 0 ? timelock / 3n : timelock; // 0 = FIVE_MINUTES
      console.log("Effective timelock:", effectiveTimelock.toString(), "seconds");
      
      // Move past end time + effective timelock
      const totalTimeToWait = 3600 + Number(effectiveTimelock) + 10; // pond duration + timelock + buffer
      console.log("Waiting", totalTimeToWait, "seconds...");
      await time.increase(totalTimeToWait);

      console.log("\n=== ATTEMPTING WINNER SELECTION ===");
      
      try {
        // Try to select winner
        const tx = await pondCore.selectLuckyWinner(pondType);
        const receipt = await tx.wait();
        
        console.log("✅ Winner selection successful!");
        console.log("Gas used:", receipt.gasUsed.toString());
        
        // Check for events
        const events = receipt.logs;
        for (const event of events) {
          try {
            const parsed = pondCore.interface.parseLog(event);
            if (parsed.name === "LuckyWinnerSelected") {
              console.log("🎉 Winner:", parsed.args.winner);
              console.log("💰 Prize:", ethers.formatEther(parsed.args.prize));
            }
          } catch (e) {
            // Skip unparseable events
          }
        }
        
      } catch (error) {
        console.log("❌ Winner selection failed:");
        console.log("Error message:", error.message);
        console.log("Error code:", error.code);
        
        // Try to get more detailed error info
        if (error.data) {
          console.log("Error data:", error.data);
        }
        
        // Check if it's a custom error
        if (error.message.includes("custom error")) {
          console.log("This appears to be a custom error revert");
        }
        
        // Re-check pond data after failed attempt
        console.log("\n=== POND DATA AFTER FAILED ATTEMPT ===");
        const debugDataAfter = await pondCore.debugPondData(pondType);
        console.log("Data still consistent:", debugDataAfter.dataConsistent);
      }
    });

    it("Should test individual components", async function () {
      console.log("\n=== TESTING INDIVIDUAL COMPONENTS ===");

      // Test 1: Single participant
      console.log("Test 1: Single participant");
      await pondCore.connect(addr1).toss(pondType, 0, { 
        value: ethers.parseEther("0.1") 
      });

      await time.increase(3700);
      
      // Check and wait for proper timelock  
      const pond = await pondCore.ponds(pondType);
      const config = await pondCore.getConfig();
      const timelock = config.selectionTimelock;
      
      // Wait additional time for timelock
      console.log("Waiting additional timelock period:", timelock.toString(), "seconds");
      await time.increase(Number(timelock) + 10); // Add buffer
      
      // Check timelock status
      const currentTime = await time.latest();
      const timeSinceEnd = currentTime - Number(pond.endTime);
      
      console.log("Current time:", currentTime);
      console.log("Pond end time:", pond.endTime.toString());
      console.log("Time since end:", timeSinceEnd);
      console.log("Required timelock:", timelock.toString());
      console.log("Can select winner:", timeSinceEnd >= timelock);
      
      try {
        await pondCore.selectLuckyWinner(pondType);
        console.log("✅ Single participant selection works");
      } catch (error) {
        console.log("❌ Single participant failed:", error.message);
      }

      // Reset pond for next test
      await pondCore.emergencyResetPond(pondType);
      await time.increase(100);
    });

    it("Should test edge cases", async function () {
      console.log("\n=== TESTING EDGE CASES ===");

      // Test: Very small amounts
      console.log("Test: Very small amounts");
      await pondCore.connect(addr1).toss(pondType, 0, { 
        value: ethers.parseEther("0.01") // Minimum amount
      });

      await pondCore.connect(addr2).toss(pondType, 0, { 
        value: ethers.parseEther("0.01")
      });

      await time.increase(3700);
      
      try {
        await pondCore.selectLuckyWinner(pondType);
        console.log("✅ Small amounts work");
      } catch (error) {
        console.log("❌ Small amounts failed:", error.message);
      }
    });

    it("Should test gas estimation", async function () {
      console.log("\n=== TESTING GAS ESTIMATION ===");

      // Add participants
      const participants = [addr1, addr2, addr3];
      for (let i = 0; i < participants.length; i++) {
        await pondCore.connect(participants[i]).toss(pondType, 0, { 
          value: ethers.parseEther("0.1")
        });
      }

      await time.increase(3700);

      try {
        // Estimate gas first
        const gasEstimate = await pondCore.selectLuckyWinner.estimateGas(pondType);
        console.log("Estimated gas:", gasEstimate.toString());
        
        // Then execute
        const tx = await pondCore.selectLuckyWinner(pondType, { gasLimit: gasEstimate + 50000n });
        const receipt = await tx.wait();
        console.log("Actual gas used:", receipt.gasUsed.toString());
        
      } catch (error) {
        console.log("❌ Gas estimation failed:", error.message);
        
        // Try with very high gas limit
        try {
          console.log("Trying with high gas limit...");
          const tx = await pondCore.selectLuckyWinner(pondType, { gasLimit: 5000000 });
          await tx.wait();
          console.log("✅ High gas limit worked");
        } catch (highGasError) {
          console.log("❌ Even high gas failed:", highGasError.message);
        }
      }
    });

    it("Should demonstrate timelock behavior and successful winner selection", async function () {
      console.log("\n=== TIMELOCK BEHAVIOR TEST ===");

      // Add a participant
      await pondCore.connect(addr1).toss(pondType, 0, { 
        value: ethers.parseEther("0.1") 
      });

      // Get pond and config info
      const pond = await pondCore.ponds(pondType);
      const config = await pondCore.getConfig();
      
      console.log("Pond end time:", new Date(Number(pond.endTime) * 1000).toISOString());
      console.log("Selection timelock:", config.selectionTimelock.toString(), "seconds");

      // Try to select winner immediately after pond ends (should fail)
      await time.increaseTo(Number(pond.endTime) + 1);
      console.log("Trying selection immediately after pond ends...");
      
      try {
        await pondCore.selectLuckyWinner(pondType);
        console.log("❌ This should have failed!");
      } catch (error) {
        console.log("✅ Expected failure: TimelockActive");
      }

      // Wait for timelock to expire
      console.log("Waiting for timelock to expire...");
      await time.increaseTo(Number(pond.endTime) + Number(config.selectionTimelock) + 10);
      
      console.log("Attempting winner selection after timelock...");
      try {
        const tx = await pondCore.selectLuckyWinner(pondType);
        const receipt = await tx.wait();
        
        console.log("✅ Winner selection successful!");
        console.log("Gas used:", receipt.gasUsed.toString());
        
        // Find the winner event
        for (const log of receipt.logs) {
          try {
            const parsed = pondCore.interface.parseLog(log);
            if (parsed.name === "LuckyWinnerSelected") {
              console.log("🎉 Winner:", parsed.args.winner);
              console.log("💰 Prize:", ethers.formatEther(parsed.args.prize), "ETH");
            }
          } catch (e) {
            // Skip unparseable logs
          }
        }
        
      } catch (error) {
        console.log("❌ Winner selection still failed:", error.message);
        
        // Debug current state
        const currentTime = await time.latest();
        const timeSinceEnd = currentTime - Number(pond.endTime);
        console.log("Current time since pond end:", timeSinceEnd);
        console.log("Required timelock:", config.selectionTimelock.toString());
      }
    });

    it("Should inspect contract state in detail", async function () {
      console.log("\n=== DETAILED CONTRACT STATE INSPECTION ===");

      // Add one participant
      await pondCore.connect(addr1).toss(pondType, 0, { 
        value: ethers.parseEther("0.1")
      });

      // Get detailed state
      const pond = await pondCore.ponds(pondType);
      console.log("Pond details:");
      console.log("- Start time:", new Date(Number(pond.startTime) * 1000).toISOString());
      console.log("- End time:", new Date(Number(pond.endTime) * 1000).toISOString());
      console.log("- Total tosses:", pond.totalTosses.toString());
      console.log("- Total participants:", pond.totalParticipants.toString());
      console.log("- Total value:", ethers.formatEther(pond.totalValue));
      console.log("- Total frog value:", ethers.formatEther(pond.totalFrogValue));
      console.log("- Prize distributed:", pond.prizeDistributed);

      // Check participants array
      const participants = await pondCore.getPondParticipants(pondType);
      console.log("Participants:", participants.length);
      for (let i = 0; i < participants.length; i++) {
        console.log(`- ${participants[i].participant}: ${ethers.formatEther(participants[i].tossAmount)} ETH`);
      }

      // Check arrays directly
      const pondParticipants = await pondCore.pondParticipants(pondType, 0);
      console.log("First participant in array:", pondParticipants);

      // Check toss data
      const firstToss = await pondCore.pondTosses(pondType, 0);
      console.log("First toss data:");
      console.log("- Participant index:", firstToss.participantIndex.toString());
      console.log("- Value:", ethers.formatEther(firstToss.value));
    });
  });
});