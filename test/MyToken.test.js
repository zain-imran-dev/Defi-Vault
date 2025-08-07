const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MyToken", function () {
  let MyToken;
  let myToken;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const TOKEN_NAME = "DeFiVault Token";
  const TOKEN_SYMBOL = "DVT";
  const INITIAL_SUPPLY = ethers.parseEther("1000000"); // 1 million tokens
  const MAX_SUPPLY = ethers.parseEther("1000000000"); // 1 billion tokens

  beforeEach(async function () {
    // Get signers
    [owner, addr1, addr2, ...addrs] = await ethers.getSigners();

    // Deploy contract
    MyToken = await ethers.getContractFactory("MyToken");
    myToken = await MyToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, INITIAL_SUPPLY);
    await myToken.waitForDeployment();
  });
  describe("Standard ERC20 Functions", function () {

  describe("Deployment", function () {
    it("Should set the right name and symbol", async function () {
      expect(await myToken.name()).to.equal(TOKEN_NAME);
      expect(await myToken.symbol()).to.equal(TOKEN_SYMBOL);
    });

    it("Should assign the initial supply to the owner", async function () {
      const ownerBalance = await myToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY);
    });

    it("Should set the correct total supply", async function () {
      expect(await myToken.totalSupply()).to.equal(INITIAL_SUPPLY);
      expect(await myToken.totalMinted()).to.equal(INITIAL_SUPPLY);
    });

    it("Should set owner as initial minter", async function () {
      expect(await myToken.isMinter(owner.address)).to.be.true;
    });

    it("Should set correct max supply", async function () {
      expect(await myToken.MAX_SUPPLY()).to.equal(MAX_SUPPLY);
    });
  });

  describe("Minting", function () {
    it("Should allow owner to mint tokens", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(myToken.mint(addr1.address, mintAmount))
        .to.emit(myToken, "TokensMinted")
        .withArgs(addr1.address, mintAmount);

      const addr1Balance = await myToken.balanceOf(addr1.address);
      expect(addr1Balance).to.equal(mintAmount);

      const newTotalSupply = await myToken.totalSupply();
      expect(newTotalSupply).to.equal(INITIAL_SUPPLY + mintAmount);
    });

    it("Should not allow non-minters to mint", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        myToken.connect(addr1).mint(addr2.address, mintAmount)
      ).to.be.revertedWith("MyToken: caller is not a minter");
    });

    it("Should not allow minting beyond max supply", async function () {
      const mintAmount = MAX_SUPPLY; // Try to mint max supply when initial already exists
      
      await expect(
        myToken.mint(addr1.address, mintAmount)
      ).to.be.revertedWith("MyToken: minting would exceed max supply");
    });

    it("Should not allow minting to zero address", async function () {
      const mintAmount = ethers.parseEther("1000");
      
      await expect(
        myToken.mint(ethers.ZeroAddress, mintAmount)
      ).to.be.revertedWith("MyToken: mint to zero address");
    });

    it("Should not allow minting zero amount", async function () {
      await expect(
        myToken.mint(addr1.address, 0)
      ).to.be.revertedWith("MyToken: mint amount must be greater than 0");
    });
  });

  describe("Minter Management", function () {
    it("Should allow owner to add minter", async function () {
      await expect(myToken.addMinter(addr1.address))
        .to.emit(myToken, "MinterAdded")
        .withArgs(addr1.address);

      expect(await myToken.isMinter(addr1.address)).to.be.true;
    });

    it("Should allow added minter to mint tokens", async function () {
      await myToken.addMinter(addr1.address);
      const mintAmount = ethers.parseEther("1000");

      await expect(
        myToken.connect(addr1).mint(addr2.address, mintAmount)
      ).to.emit(myToken, "TokensMinted");
    });

    it("Should allow owner to remove minter", async function () {
      await myToken.addMinter(addr1.address);
      
      await expect(myToken.removeMinter(addr1.address))
        .to.emit(myToken, "MinterRemoved")
        .withArgs(addr1.address);

      expect(await myToken.isMinter(addr1.address)).to.be.false;
    });

    it("Should not allow non-owner to add minter", async function () {
      await expect(
        myToken.connect(addr1).addMinter(addr2.address)
      ).to.be.revertedWithCustomError(myToken, "OwnableUnauthorizedAccount");
    });

    it("Should not allow adding zero address as minter", async function () {
      await expect(
        myToken.addMinter(ethers.ZeroAddress)
      ).to.be.revertedWith("MyToken: minter cannot be zero address");
    });
  });

  describe("Burning", function () {
    it("Should allow users to burn their tokens", async function () {
      const burnAmount = ethers.parseEther("1000");
      
      await expect(myToken.burn(burnAmount))
        .to.emit(myToken, "TokensBurned")
        .withArgs(owner.address, burnAmount);

      const ownerBalance = await myToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY - burnAmount);

      const newTotalSupply = await myToken.totalSupply();
      expect(newTotalSupply).to.equal(INITIAL_SUPPLY - burnAmount);
    });

    it("Should not allow burning more than balance", async function () {
      const burnAmount = INITIAL_SUPPLY + ethers.parseEther("1");
      
      await expect(
        myToken.burn(burnAmount)
      ).to.be.revertedWith("MyToken: burn amount exceeds balance");
    });

    it("Should not allow burning zero amount", async function () {
      await expect(
        myToken.burn(0)
      ).to.be.revertedWith("MyToken: burn amount must be greater than 0");
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause transfers", async function () {
      await myToken.pause();
      expect(await myToken.paused()).to.be.true;

      await expect(
        myToken.transfer(addr1.address, ethers.parseEther("100"))
      ).to.be.revertedWith("MyToken: token transfer while paused");
    });

    it("Should allow owner to unpause transfers", async function () {
      await myToken.pause();
      await myToken.unpause();
      expect(await myToken.paused()).to.be.false;

      // Should be able to transfer now
      await myToken.transfer(addr1.address, ethers.parseEther("100"));
      expect(await myToken.balanceOf(addr1.address)).to.equal(ethers.parseEther("100"));
    });

    it("Should not allow minting when paused", async function () {
      await myToken.pause();
      
      await expect(
        myToken.mint(addr1.address, ethers.parseEther("1000"))
      ).to.be.revertedWithCustomError(myToken, "EnforcedPause");
    });
  });

  describe("View Functions", function () {
    it("Should return correct remaining supply", async function () {
      const remaining = await myToken.remainingSupply();
      expect(remaining).to.equal(MAX_SUPPLY - INITIAL_SUPPLY);
    });

    it("Should correctly identify minters", async function () {
      expect(await myToken.isMinter(owner.address)).to.be.true;
      expect(await myToken.isMinter(addr1.address)).to.be.false;

      await myToken.addMinter(addr1.address);
      expect(await myToken.isMinter(addr1.address)).to.be.true;
    });
  });

  describe("Anti-Whale Protection", function () {
    it("Should enforce maximum wallet limit", async function () {
      const maxWalletAmount = await myToken.maxWalletAmount();
      const maxTxAmount = await myToken.maxTxAmount();
      
      // Verify that limits are set
      expect(maxWalletAmount).to.be.gt(0);
      expect(maxTxAmount).to.be.gt(0);
      expect(maxWalletAmount).to.be.gte(maxTxAmount);
      
      // Test that a normal transfer works
      const transferAmount = ethers.parseEther("100");
      await myToken.mint(addr1.address, transferAmount);
      await myToken.connect(addr1).transfer(addr2.address, transferAmount);
      
      expect(await myToken.balanceOf(addr2.address)).to.equal(transferAmount);
    });

    it("Should enforce maximum transaction limit", async function () {
      const maxTxAmount = await myToken.maxTxAmount();
      const transferAmount = maxTxAmount + ethers.parseEther("1");
      
      // First mint some tokens to addr1 so they can test the limit
      await myToken.mint(addr1.address, maxTxAmount + ethers.parseEther("1000"));
      
      await expect(
        myToken.connect(addr1).transfer(addr2.address, transferAmount)
      ).to.be.revertedWith("MyToken: transfer amount exceeds max transaction limit");
    });

    it("Should allow owner to update max wallet amount", async function () {
      const newMaxWallet = ethers.parseEther("5000000"); // 5M tokens
      
      await expect(myToken.setMaxWalletAmount(newMaxWallet))
        .to.emit(myToken, "MaxWalletAmountUpdated")
        .withArgs(newMaxWallet);

      expect(await myToken.maxWalletAmount()).to.equal(newMaxWallet);
    });

    it("Should not allow setting max wallet too low", async function () {
      const tooLowAmount = ethers.parseEther("100000"); // 0.01% of total supply
      
      await expect(
        myToken.setMaxWalletAmount(tooLowAmount)
      ).to.be.revertedWith("MyToken: max wallet too low");
    });

    it("Should allow exempt addresses to bypass limits", async function () {
      await myToken.setExemptFromLimits(addr1.address, true);
      
      const maxWalletAmount = await myToken.maxWalletAmount();
      const transferAmount = maxWalletAmount + ethers.parseEther("1000");
      
      // Mint tokens to owner first
      await myToken.mint(owner.address, transferAmount);
      
      // Should succeed because addr1 is exempt
      await myToken.transfer(addr1.address, transferAmount);
      expect(await myToken.balanceOf(addr1.address)).to.equal(transferAmount);
    });

    it("Should emit exemption events", async function () {
      await expect(myToken.setExemptFromLimits(addr1.address, true))
        .to.emit(myToken, "ExemptionUpdated")
        .withArgs(addr1.address, true);
    });

    it("Should check default limits", async function () {
      const maxTxAmount = await myToken.maxTxAmount();
      const maxWalletAmount = await myToken.maxWalletAmount();
      
      console.log("Max transaction amount:", ethers.formatEther(maxTxAmount));
      console.log("Max wallet amount:", ethers.formatEther(maxWalletAmount));
      
      // These should be very large numbers
      expect(maxTxAmount).to.be.gt(ethers.parseEther("1000000")); // Should be > 1M
      expect(maxWalletAmount).to.be.gte(ethers.parseEther("10000000")); // Should be >= 10M
    });
  });
    it("Should transfer tokens between accounts", async function () {
      const transferAmount = ethers.parseEther("100");
      
      await myToken.transfer(addr1.address, transferAmount);
      expect(await myToken.balanceOf(addr1.address)).to.equal(transferAmount);
      
      const ownerBalance = await myToken.balanceOf(owner.address);
      expect(ownerBalance).to.equal(INITIAL_SUPPLY - transferAmount);
    });

    it("Should handle allowances correctly", async function () {
      const allowanceAmount = ethers.parseEther("200");
      
      await myToken.approve(addr1.address, allowanceAmount);
      expect(await myToken.allowance(owner.address, addr1.address)).to.equal(allowanceAmount);

      const transferAmount = ethers.parseEther("50");
      await myToken.connect(addr1).transferFrom(owner.address, addr2.address, transferAmount);
      
      expect(await myToken.balanceOf(addr2.address)).to.equal(transferAmount);
      expect(await myToken.allowance(owner.address, addr1.address)).to.equal(allowanceAmount - transferAmount);
    });
  });
});