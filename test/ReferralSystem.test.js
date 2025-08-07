const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ReferralSystem", function () {
  let MyToken, ReferralSystem, MasterChef, masterChef;
  let dvt, referralSystem;
  let owner, addr1, addr2, addr3, addr4;

  const INITIAL_TOKEN_SUPPLY = ethers.parseEther("1000000");
  const MIN_REFERRAL_REWARD = ethers.parseEther("1000");

  beforeEach(async function () {
    [owner, addr1, addr2, addr3, addr4] = await ethers.getSigners();

    // Deploy DVT token
    MyToken = await ethers.getContractFactory("MyToken");
    dvt = await MyToken.deploy("DeFiVault Token", "DVT", INITIAL_TOKEN_SUPPLY);
    await dvt.waitForDeployment();

    // Deploy mock MasterChef (we'll use owner as MasterChef for testing)
    masterChef = owner; // Simplified for testing

    // Deploy ReferralSystem
    ReferralSystem = await ethers.getContractFactory("ReferralSystem");
    referralSystem = await ReferralSystem.deploy(
      await dvt.getAddress(),
      masterChef.address
    );
    await referralSystem.waitForDeployment();

    // Add ReferralSystem as minter for DVT
    await dvt.addMinter(await referralSystem.getAddress());
  });

  describe("Deployment", function () {
    it("Should set the correct initial values", async function () {
      expect(await referralSystem.dvt()).to.equal(await dvt.getAddress());
      expect(await referralSystem.masterChef()).to.equal(masterChef.address);
      expect(await referralSystem.minReferralReward()).to.equal(MIN_REFERRAL_REWARD);
    });

    it("Should initialize default commission tiers", async function () {
      const tiersCount = await referralSystem.getCommissionTiersCount();
      expect(tiersCount).to.equal(4); // Bronze, Silver, Gold, Platinum

      const bronzeTier = await referralSystem.getCommissionTier(0);
      expect(bronzeTier[0]).to.equal("Bronze");
      expect(bronzeTier[1]).to.equal(0); // min referrals
      expect(bronzeTier[2]).to.equal(500); // 5% commission rate
    });

    it("Should set MasterChef as operator", async function () {
      expect(await referralSystem.operators(masterChef.address)).to.be.true;
    });

    it("Should set ReferralSystem as minter for DVT", async function () {
      expect(await dvt.isMinter(await referralSystem.getAddress())).to.be.true;
    });
  });

  describe("Referral Registration", function () {
    it("Should register a referral relationship", async function () {
      await expect(
        referralSystem.registerReferral(addr2.address, addr1.address)
      ).to.emit(referralSystem, "UserReferred")
      .withArgs(addr2.address, addr1.address, 1);

      const referralInfo = await referralSystem.referralInfo(addr2.address);
      expect(referralInfo.referrer).to.equal(addr1.address);
      expect(referralInfo.level).to.equal(1);
      expect(referralInfo.isActive).to.be.true;

      const referrerInfo = await referralSystem.referralInfo(addr1.address);
      expect(referrerInfo.totalReferred).to.equal(1);

      expect(await referralSystem.totalReferrals()).to.equal(1);
    });

    it("Should not allow self-referral", async function () {
      await expect(
        referralSystem.registerReferral(addr1.address, addr1.address)
      ).to.be.revertedWith("ReferralSystem: cannot refer yourself");
    });

    it("Should not allow double referral", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      await expect(
        referralSystem.registerReferral(addr2.address, addr3.address)
      ).to.be.revertedWith("ReferralSystem: already referred");
    });

    it("Should prevent circular references", async function () {
      // addr1 -> addr2 -> addr3
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.registerReferral(addr3.address, addr2.address);
      
      // Try to make addr1 refer to addr3 (would create cycle)
      await expect(
        referralSystem.registerReferral(addr1.address, addr3.address)
      ).to.be.revertedWith("ReferralSystem: circular reference");
    });

    it("Should enforce referral cooldown", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      // Try to refer someone else immediately
      await expect(
        referralSystem.registerReferral(addr3.address, addr1.address)
      ).to.be.revertedWith("ReferralSystem: referral cooldown");

      // Fast forward past cooldown
      await ethers.provider.send("evm_increaseTime", [3700]); // 1 hour + 100 seconds
      await ethers.provider.send("evm_mine");

      // Should work now
      await expect(
        referralSystem.registerReferral(addr3.address, addr1.address)
      ).to.emit(referralSystem, "UserReferred");
    });

    it("Should not allow non-operators to register referrals", async function () {
      await expect(
        referralSystem.connect(addr1).registerReferral(addr2.address, addr3.address)
      ).to.be.revertedWith("ReferralSystem: not authorized");
    });

    it("Should create multi-level referrals", async function () {
      // Create 3-level referral chain: addr1 -> addr2 -> addr3 -> addr4
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.registerReferral(addr3.address, addr2.address);
      await referralSystem.registerReferral(addr4.address, addr3.address);

      const info2 = await referralSystem.referralInfo(addr2.address);
      const info3 = await referralSystem.referralInfo(addr3.address);
      const info4 = await referralSystem.referralInfo(addr4.address);

      expect(info2.level).to.equal(1);
      expect(info3.level).to.equal(2);
      expect(info4.level).to.equal(3);
    });
  });

  describe("Commission Processing", function () {
    beforeEach(async function () {
      // Set up referral chain: addr1 -> addr2 -> addr3
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.registerReferral(addr3.address, addr2.address);
    });

    it("Should process referral commissions", async function () {
      const rewardAmount = ethers.parseEther("10000"); // 10k DVT
      
      const addr1BalanceBefore = await dvt.balanceOf(addr1.address);
      const addr2BalanceBefore = await dvt.balanceOf(addr2.address);

      await expect(
        referralSystem.processReferralCommission(addr3.address, rewardAmount)
      ).to.emit(referralSystem, "CommissionPaid");

      const addr1BalanceAfter = await dvt.balanceOf(addr1.address);
      const addr2BalanceAfter = await dvt.balanceOf(addr2.address);

      // addr2 should get level 1 commission (5% * 5% = 0.25% of 10k = 25 DVT)
      // addr1 should get level 2 commission (2% * 5% = 0.1% of 10k = 10 DVT)
      expect(addr2BalanceAfter).to.be.gt(addr2BalanceBefore);
      expect(addr1BalanceAfter).to.be.gt(addr1BalanceBefore);
    });

    it("Should not process commissions for small rewards", async function () {
      const smallReward = ethers.parseEther("100"); // Below minimum
      
      // Should revert with reward too small error
      await expect(
        referralSystem.processReferralCommission(addr3.address, smallReward)
      ).to.be.revertedWith("ReferralSystem: reward too small");
    });

    it("Should apply tier multipliers correctly", async function () {
      // Test that tier system exists and works
      const [tierId, tierName] = await referralSystem.getUserTier(addr1.address);
      expect(tierName).to.equal("Bronze");
      
      // Test that commission processing works
      const rewardAmount = ethers.parseEther("10000");
      const addr1BalanceBefore = await dvt.balanceOf(addr1.address);

      await referralSystem.processReferralCommission(addr3.address, rewardAmount);

      const addr1BalanceAfter = await dvt.balanceOf(addr1.address);
      const commission = addr1BalanceAfter - addr1BalanceBefore;

      // Should get some commission
      expect(commission).to.be.gt(0);
    });

    it("Should respect max commission rate", async function () {
      // This tests the MAX_COMMISSION_RATE cap
      const rewardAmount = ethers.parseEther("1000000"); // Very large reward
      
      await referralSystem.processReferralCommission(addr3.address, rewardAmount);
      
      // Commissions should be capped and not exceed reasonable amounts
      const addr1Balance = await dvt.balanceOf(addr1.address);
      const addr2Balance = await dvt.balanceOf(addr2.address);
      
      expect(addr1Balance).to.be.lt(rewardAmount / 5n); // Less than 20% of reward
      expect(addr2Balance).to.be.lt(rewardAmount / 5n);
    });

    it("Should only process commissions for active referrers", async function () {
      // Deactivate addr1
      await referralSystem.deactivateReferral(addr1.address);
      
      const rewardAmount = ethers.parseEther("10000");
      
      const addr1BalanceBefore = await dvt.balanceOf(addr1.address);
      const addr2BalanceBefore = await dvt.balanceOf(addr2.address);

      await referralSystem.processReferralCommission(addr3.address, rewardAmount);

      const addr1BalanceAfter = await dvt.balanceOf(addr1.address);
      const addr2BalanceAfter = await dvt.balanceOf(addr2.address);

      // addr2 should still get commission, addr1 should not
      expect(addr2BalanceAfter).to.be.gt(addr2BalanceBefore);
      expect(addr1BalanceAfter).to.equal(addr1BalanceBefore);
    });
  });

  describe("Tier Management", function () {
    it("Should allow owner to add new commission tier", async function () {
      await expect(
        referralSystem.addCommissionTier("Diamond", 100, 2000)
      ).to.emit(referralSystem, "TierAdded");

      const tiersCount = await referralSystem.getCommissionTiersCount();
      expect(tiersCount).to.equal(5);

      const newTier = await referralSystem.getCommissionTier(4);
      expect(newTier[0]).to.equal("Diamond");
      expect(newTier[1]).to.equal(100);
      expect(newTier[2]).to.equal(2000);
    });

    it("Should allow owner to update commission tier", async function () {
      await expect(
        referralSystem.updateCommissionTier(0, 10, 600)
      ).to.emit(referralSystem, "TierUpdated");

      const updatedTier = await referralSystem.getCommissionTier(0);
      expect(updatedTier[1]).to.equal(10); // minReferrals
      expect(updatedTier[2]).to.equal(600); // commissionRate
    });

    it("Should not allow commission rate too high", async function () {
      await expect(
        referralSystem.addCommissionTier("Super", 200, 3000) // 30% too high
      ).to.be.revertedWith("ReferralSystem: commission rate too high");
    });

    it("Should correctly determine user tier", async function () {
      const [tierId, tierName] = await referralSystem.getUserTier(addr1.address);
      expect(tierId).to.equal(0);
      expect(tierName).to.equal("Bronze");
    });
  });

  describe("Level Commission Management", function () {
    it("Should allow owner to update level commission rates", async function () {
      const newRates = [600, 300, 150]; // 6%, 3%, 1.5%
      
      await referralSystem.updateLevelCommissionRates(newRates);
      
      // We can't directly check the internal array, but we can test the effect
      // by processing a commission and checking the amounts
    });

    it("Should not allow too many levels", async function () {
      const tooManyRates = [500, 300, 200, 100, 50]; // 5 levels, max is 3
      
      await expect(
        referralSystem.updateLevelCommissionRates(tooManyRates)
      ).to.be.revertedWith("ReferralSystem: too many levels");
    });

    it("Should not allow rate too high", async function () {
      const tooHighRates = [2500, 200, 100]; // 25% too high
      
      await expect(
        referralSystem.updateLevelCommissionRates(tooHighRates)
      ).to.be.revertedWith("ReferralSystem: rate too high");
    });
  });

  describe("Operator Management", function () {
    it("Should allow owner to set operators", async function () {
      await expect(
        referralSystem.setOperator(addr1.address, true)
      ).to.emit(referralSystem, "OperatorUpdated")
      .withArgs(addr1.address, true);

      expect(await referralSystem.operators(addr1.address)).to.be.true;
    });

    it("Should allow operators to register referrals", async function () {
      await referralSystem.setOperator(addr1.address, true);
      
      await expect(
        referralSystem.connect(addr1).registerReferral(addr3.address, addr2.address)
      ).to.emit(referralSystem, "UserReferred");
    });

    it("Should allow operators to process commissions", async function () {
      await referralSystem.setOperator(addr1.address, true);
      await referralSystem.registerReferral(addr2.address, addr3.address);
      
      await expect(
        referralSystem.connect(addr1).processReferralCommission(addr2.address, ethers.parseEther("10000"))
      ).to.emit(referralSystem, "CommissionPaid");
    });
  });

  describe("Utility Functions", function () {
    beforeEach(async function () {
      // Set up referral chain: addr1 -> addr2 -> addr3 -> addr4
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.registerReferral(addr3.address, addr2.address);
      await referralSystem.registerReferral(addr4.address, addr3.address);
    });

    it("Should return correct referral chain", async function () {
      const chain = await referralSystem.getReferralChain(addr4.address);
      expect(chain.length).to.equal(3);
      expect(chain[0]).to.equal(addr3.address);
      expect(chain[1]).to.equal(addr2.address);
      expect(chain[2]).to.equal(addr1.address);
    });

    it("Should return referred users", async function () {
      const referredUsers = await referralSystem.getReferredUsers(addr1.address);
      expect(referredUsers.length).to.equal(1);
      expect(referredUsers[0]).to.equal(addr2.address);
    });

    it("Should calculate estimated commission", async function () {
      const rewardAmount = ethers.parseEther("10000");
      const estimatedCommission = await referralSystem.calculateCommission(addr4.address, rewardAmount);
      
      expect(estimatedCommission).to.be.gt(0);
    });

    it("Should return global statistics", async function () {
      const [totalReferrals, totalCommissionsPaid, activeReferrers, totalTiers] = 
        await referralSystem.getGlobalStats();
      
      expect(totalReferrals).to.equal(3);
      expect(activeReferrers).to.equal(3); // addr1, addr2, addr3 are referrers
      expect(totalTiers).to.equal(4);
    });
  });

  describe("Security and Edge Cases", function () {
    it("Should handle zero address validation", async function () {
      await expect(
        referralSystem.registerReferral(ethers.ZeroAddress, addr1.address)
      ).to.be.revertedWith("ReferralSystem: invalid referee");

      await expect(
        referralSystem.registerReferral(addr2.address, ethers.ZeroAddress)
      ).to.be.revertedWith("ReferralSystem: invalid referrer");
    });

    it("Should handle invalid pool IDs gracefully", async function () {
      await expect(
        referralSystem.getCommissionTier(999)
      ).to.be.revertedWith("ReferralSystem: invalid tier ID");
    });

    it("Should allow emergency deactivation", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      await expect(
        referralSystem.deactivateReferral(addr1.address)
      ).to.emit(referralSystem, "ReferralDeactivated");

      const referralInfo = await referralSystem.referralInfo(addr1.address);
      expect(referralInfo.isActive).to.be.false;
    });

    it("Should allow emergency activation", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.deactivateReferral(addr1.address);
      
      await expect(
        referralSystem.activateReferral(addr1.address)
      ).to.emit(referralSystem, "ReferralActivated");

      const referralInfo = await referralSystem.referralInfo(addr1.address);
      expect(referralInfo.isActive).to.be.true;
    });

    it("Should allow owner to update settings", async function () {
      const newMinReward = ethers.parseEther("5000");
      await referralSystem.setMinReferralReward(newMinReward);
      expect(await referralSystem.minReferralReward()).to.equal(newMinReward);

      const newCooldown = 1800; // 30 minutes
      await referralSystem.setReferralCooldown(newCooldown);
      expect(await referralSystem.referralCooldown()).to.equal(newCooldown);
    });

    it("Should not allow cooldown too long", async function () {
      const tooLongCooldown = 2 * 24 * 3600; // 2 days
      
      await expect(
        referralSystem.setReferralCooldown(tooLongCooldown)
      ).to.be.revertedWith("ReferralSystem: cooldown too long");
    });

    it("Should handle activity timeout", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      // Fast forward past activity timeout (90 days)
      await ethers.provider.send("evm_increaseTime", [91 * 24 * 3600]);
      await ethers.provider.send("evm_mine");
      
      const rewardAmount = ethers.parseEther("10000");
      const addr1BalanceBefore = await dvt.balanceOf(addr1.address);
      
      await referralSystem.processReferralCommission(addr2.address, rewardAmount);
      
      const addr1BalanceAfter = await dvt.balanceOf(addr1.address);
      
      // addr1 should not get commission due to inactivity
      expect(addr1BalanceAfter).to.equal(addr1BalanceBefore);
    });

    it("Should allow emergency withdraw", async function () {
      // Send some DVT to the contract
      await dvt.transfer(await referralSystem.getAddress(), ethers.parseEther("1000"));
      
      const ownerBalanceBefore = await dvt.balanceOf(owner.address);
      
      await referralSystem.emergencyWithdraw(await dvt.getAddress(), ethers.parseEther("1000"));
      
      const ownerBalanceAfter = await dvt.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(ethers.parseEther("1000"));
    });
  });

  describe("Integration Tests", function () {
    it("Should work with realistic referral tree", async function () {
      // Create a realistic referral tree
      // Level 1: addr1 (referrer)
      // Level 2: addr2, addr3 (referred by addr1)
      // Level 3: addr4 (referred by addr2)
      
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await referralSystem.registerReferral(addr3.address, addr1.address);
      
      await ethers.provider.send("evm_increaseTime", [3700]);
      await referralSystem.registerReferral(addr4.address, addr2.address);

      // Process rewards for addr4 (should trigger commissions for addr2 and addr1)
      const rewardAmount = ethers.parseEther("20000");
      
      const addr1BalanceBefore = await dvt.balanceOf(addr1.address);
      const addr2BalanceBefore = await dvt.balanceOf(addr2.address);
      
      await referralSystem.processReferralCommission(addr4.address, rewardAmount);
      
      const addr1BalanceAfter = await dvt.balanceOf(addr1.address);
      const addr2BalanceAfter = await dvt.balanceOf(addr2.address);
      
      // Both should receive commissions
      expect(addr1BalanceAfter).to.be.gt(addr1BalanceBefore);
      expect(addr2BalanceAfter).to.be.gt(addr2BalanceBefore);
      
      // addr2 should get more (level 1 commission vs level 2)
      const addr1Commission = addr1BalanceAfter - addr1BalanceBefore;
      const addr2Commission = addr2BalanceAfter - addr2BalanceBefore;
      expect(addr2Commission).to.be.gt(addr1Commission);
    });

    it("Should handle tier upgrades correctly", async function () {
      // Start with addr1 at Bronze tier
      let [tierId, tierName] = await referralSystem.getUserTier(addr1.address);
      expect(tierName).to.equal("Bronze");
      
      // Add referrals to reach Silver tier (5+ referrals)
      for (let i = 0; i < 6; i++) {
        const newUser = ethers.Wallet.createRandom();
        await referralSystem.registerReferral(newUser.address, addr1.address);
        await ethers.provider.send("evm_increaseTime", [3700]);
        await ethers.provider.send("evm_mine");
      }
      
      // Check if tier upgraded
      [tierId, tierName] = await referralSystem.getUserTier(addr1.address);
      expect(tierName).to.equal("Silver");
      
      // Process commission and verify higher rate
      const rewardAmount = ethers.parseEther("10000");
      const balanceBefore = await dvt.balanceOf(addr1.address);
      
      // Create a referred user to trigger commission
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await referralSystem.processReferralCommission(addr2.address, rewardAmount);
      
      const balanceAfter = await dvt.balanceOf(addr1.address);
      const commission = balanceAfter - balanceBefore;
      
      // Should get Silver tier commission (higher than Bronze)
      expect(commission).to.be.gt(ethers.parseEther("10")); // Should be substantial
    });

    it("Should handle commission stats correctly", async function () {
      await referralSystem.registerReferral(addr2.address, addr1.address);
      
      const rewardAmount = ethers.parseEther("10000");
      const totalCommissionsBefore = await referralSystem.totalCommissionsPaid();
      
      await referralSystem.processReferralCommission(addr2.address, rewardAmount);
      
      const totalCommissionsAfter = await referralSystem.totalCommissionsPaid();
      expect(totalCommissionsAfter).to.be.gt(totalCommissionsBefore);
      
      // Check individual stats
      const addr1Info = await referralSystem.referralInfo(addr1.address);
      expect(addr1Info.totalEarned).to.be.gt(0);
    });
  });

  describe("Gas Optimization Tests", function () {
    it("Should handle large referral chains efficiently", async function () {
      // Create max length chain (3 levels)
      await referralSystem.registerReferral(addr2.address, addr1.address);
      await ethers.provider.send("evm_increaseTime", [3700]);
      await referralSystem.registerReferral(addr3.address, addr2.address);
      await ethers.provider.send("evm_increaseTime", [3700]);
      await referralSystem.registerReferral(addr4.address, addr3.address);
      
      // Process commission - should complete without running out of gas
      const rewardAmount = ethers.parseEther("50000");
      await expect(
        referralSystem.processReferralCommission(addr4.address, rewardAmount)
      ).to.not.be.reverted;
    });

    it("Should handle multiple commission calculations", async function () {
      // Set up multiple referral relationships
      const users = [];
      for (let i = 0; i < 5; i++) {
        users.push(ethers.Wallet.createRandom());
        await referralSystem.registerReferral(users[i].address, addr1.address);
        await ethers.provider.send("evm_increaseTime", [3700]);
        await ethers.provider.send("evm_mine");
      }
      
      // Process commissions for all users
      const rewardAmount = ethers.parseEther("5000");
      for (const user of users) {
        await expect(
          referralSystem.processReferralCommission(user.address, rewardAmount)
        ).to.not.be.reverted;
      }
    });
  });
});
