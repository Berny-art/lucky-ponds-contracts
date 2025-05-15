// test/PondCore.test.js
const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PondCore Contract", () => {
	let PondCore;
	let pondCore;
	let owner;
	let distributor;
	let user1;
	let user2;

	beforeEach(async () => {
		// Get signers
		[owner, distributor, user1, user2] = await ethers.getSigners();

		// Deploy PondCore
		PondCore = await ethers.getContractFactory("PondCore");

		console.log("Deploying test PondCore with parameters:");
		console.log(`- Fee Address: ${distributor.address}`);
		console.log("- Fee Percentage: 7");
		console.log("- Selection Timelock: 60");

		pondCore = await PondCore.deploy(distributor.address, 7, 60);
		await pondCore.waitForDeployment();
		console.log("PondCore deployed to:", await pondCore.getAddress());
	});

	describe("Deployment", () => {
		it("Should deploy successfully with the right parameters", async () => {
			expect(await pondCore.feeAddress()).to.equal(distributor.address);
			expect(await pondCore.feePercent()).to.equal(7);
			expect(await pondCore.selectionTimelock()).to.equal(60);
		});

		it("Should set standard pond types", async () => {
			const standardTypes = await pondCore.getStandardPondTypes();
			expect(standardTypes.fiveMin).to.not.equal(ethers.ZeroHash);
			expect(standardTypes.hourly).to.not.equal(ethers.ZeroHash);
			expect(standardTypes.daily).to.not.equal(ethers.ZeroHash);
			expect(standardTypes.weekly).to.not.equal(ethers.ZeroHash);
			expect(standardTypes.monthly).to.not.equal(ethers.ZeroHash);
		});

		it("Should set proper roles", async () => {
			const adminRole = await pondCore.ADMIN_ROLE();
			const managerRole = await pondCore.POND_MANAGER_ROLE();

			expect(await pondCore.hasRole(adminRole, owner.address)).to.be.true;
			expect(await pondCore.hasRole(managerRole, owner.address)).to.be.true;
		});

		it("Should set default values", async () => {
			expect(await pondCore.defaultMinTossPrice()).to.equal(
				ethers.parseEther("0.0001"),
			);
			expect(await pondCore.defaultMaxTotalTossAmount()).to.equal(
				ethers.parseEther("10"),
			);
		});
	});

	describe("Pond Factory Role", () => {
		it("Should allow granting FACTORY_ROLE", async () => {
			const factoryRole = await pondCore.FACTORY_ROLE();
			await pondCore.grantRole(factoryRole, user1.address);
			expect(await pondCore.hasRole(factoryRole, user1.address)).to.be.true;
		});
	});

	describe("Pond Creation (partial test)", () => {
		it("Should prepare for pond creation", async () => {
			const factoryRole = await pondCore.FACTORY_ROLE();
			await pondCore.grantRole(factoryRole, owner.address);

			// We would test pond creation here, but this is just to verify the contract can be deployed
			expect(await pondCore.hasRole(factoryRole, owner.address)).to.be.true;
		});
	});
});
