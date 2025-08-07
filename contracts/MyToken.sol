// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title DeFiVault Token (DVT)
 * @dev ERC20 Token with minting functionality and basic security features
 * @notice Main utility token for the DeFiVault ecosystem
 */
contract MyToken is ERC20, Ownable, Pausable {
    uint256 public constant MAX_SUPPLY = 1000000000 * 10**18; // 1 billion tokens
    uint256 public totalMinted;
    
    // Anti-whale protection
    uint256 public maxWalletAmount = MAX_SUPPLY / 100; // 1% of total supply (10M tokens)
    uint256 public maxTxAmount = MAX_SUPPLY / 200; // 0.5% of total supply (5M tokens)
    
    // Exemptions from limits
    mapping(address => bool) public isExemptFromLimits;
    
    // Minting permissions
    mapping(address => bool) public minters;
    
    event MinterAdded(address indexed account);
    event MinterRemoved(address indexed account);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);
    event MaxWalletAmountUpdated(uint256 newAmount);
    event MaxTxAmountUpdated(uint256 newAmount);
    event ExemptionUpdated(address indexed account, bool exempt);

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "MyToken: caller is not a minter");
        _;
    }

    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(initialSupply <= MAX_SUPPLY, "MyToken: initial supply exceeds max supply");
        
        if (initialSupply > 0) {
            _mint(msg.sender, initialSupply);
            totalMinted = initialSupply;
        }
        
        // Add deployer as initial minter and exempt from limits
        minters[msg.sender] = true;
        isExemptFromLimits[msg.sender] = true;
        emit MinterAdded(msg.sender);
        emit ExemptionUpdated(msg.sender, true);
    }

    /**
     * @dev Mint tokens to specified address
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external onlyMinter whenNotPaused {
        require(to != address(0), "MyToken: mint to zero address");
        require(amount > 0, "MyToken: mint amount must be greater than 0");
        require(totalMinted + amount <= MAX_SUPPLY, "MyToken: minting would exceed max supply");
        
        _mint(to, amount);
        totalMinted += amount;
        
        emit TokensMinted(to, amount);
    }

    /**
     * @dev Burn tokens from caller's balance
     * @param amount Amount of tokens to burn
     */
    function burn(uint256 amount) external {
        require(amount > 0, "MyToken: burn amount must be greater than 0");
        require(balanceOf(msg.sender) >= amount, "MyToken: burn amount exceeds balance");
        
        _burn(msg.sender, amount);
        totalMinted -= amount;
        
        emit TokensBurned(msg.sender, amount);
    }

    /**
     * @dev Add minter role to address
     * @param account Address to add as minter
     */
    function addMinter(address account) external onlyOwner {
        require(account != address(0), "MyToken: minter cannot be zero address");
        require(!minters[account], "MyToken: account is already a minter");
        
        minters[account] = true;
        emit MinterAdded(account);
    }

    /**
     * @dev Remove minter role from address
     * @param account Address to remove from minters
     */
    function removeMinter(address account) external onlyOwner {
        require(minters[account], "MyToken: account is not a minter");
        
        minters[account] = false;
        emit MinterRemoved(account);
    }

    /**
     * @dev Pause token transfers
     */
    function pause() external onlyOwner {
        _pause();
    }

    /**
     * @dev Unpause token transfers
     */
    function unpause() external onlyOwner {
        _unpause();
    }

    /**
     * @dev Update maximum wallet amount (anti-whale protection)
     */
    function setMaxWalletAmount(uint256 _maxWalletAmount) external onlyOwner {
        require(_maxWalletAmount >= MAX_SUPPLY / 1000, "MyToken: max wallet too low"); // Min 0.1%
        require(_maxWalletAmount <= MAX_SUPPLY / 10, "MyToken: max wallet too high"); // Max 10%
        
        maxWalletAmount = _maxWalletAmount;
        emit MaxWalletAmountUpdated(_maxWalletAmount);
    }

    /**
     * @dev Update maximum transaction amount
     */
    function setMaxTxAmount(uint256 _maxTxAmount) external onlyOwner {
        require(_maxTxAmount >= MAX_SUPPLY / 2000, "MyToken: max tx too low"); // Min 0.05%
        require(_maxTxAmount <= MAX_SUPPLY / 20, "MyToken: max tx too high"); // Max 5%
        
        maxTxAmount = _maxTxAmount;
        emit MaxTxAmountUpdated(_maxTxAmount);
    }

    /**
     * @dev Set exemption from limits for address
     */
    function setExemptFromLimits(address account, bool exempt) external onlyOwner {
        require(account != address(0), "MyToken: cannot exempt zero address");
        
        isExemptFromLimits[account] = exempt;
        emit ExemptionUpdated(account, exempt);
    }

    /**
     * @dev Get remaining mintable supply
     */
    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    /**
     * @dev Check if address is a minter
     */
    function isMinter(address account) external view returns (bool) {
        return minters[account];
    }

    /**
     * @dev Check anti-whale limits for transfers
     */
    function _checkLimits(address from, address to, uint256 amount) internal view {
        // Skip limits for exempt addresses
        if (isExemptFromLimits[from] || isExemptFromLimits[to]) {
            return;
        }
        
        // Check max transaction amount
        if (amount > maxTxAmount) {
            revert("MyToken: transfer amount exceeds max transaction limit");
        }
        
        // Check max wallet amount for recipient
        if (to != address(0) && balanceOf(to) + amount > maxWalletAmount) {
            revert("MyToken: transfer would exceed max wallet limit");
        }
    }

    /**
     * @dev Override transfer to include pause functionality
     */
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        super._update(from, to, amount);
        require(!paused(), "MyToken: token transfer while paused");
        
        // Apply anti-whale limits only for transfers (not minting or burning)
        if (from != address(0) && to != address(0)) {
            _checkLimits(from, to, amount);
        }
    }
}