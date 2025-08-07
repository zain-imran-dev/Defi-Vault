// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./MyToken.sol";

/**
 * @title ReferralSystem
 * @dev Multi-level referral system with commission tracking
 * @notice Referrers earn percentage of their referees' farming rewards
 */
contract ReferralSystem is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct ReferralInfo {
        address referrer; // Who referred this user
        uint256 totalReferred; // Total number of people referred
        uint256 totalEarned; // Total commission earned
        uint256 level; // Referral level (0 = not referred, 1+ = referred)
        bool isActive; // Whether the referral is active
        uint256 lastActivityTime; // Last time user was active
    }

    struct CommissionTier {
        uint256 minReferrals; // Minimum referrals needed for this tier
        uint256 commissionRate; // Commission rate in basis points (100 = 1%)
        string tierName; // Name of the tier
    }

    MyToken public dvt; // DVT token for rewards
    address public masterChef; // MasterChef contract address
    
    // Referral mappings
    mapping(address => ReferralInfo) public referralInfo;
    mapping(address => address[]) public referredUsers; // referrer => list of referred users
    mapping(address => bool) public operators; // Authorized operators (like MasterChef)
    
    // Commission settings
    uint256[] public levelCommissionRates; // Commission rates for each level [level1, level2, level3]
    CommissionTier[] public commissionTiers; // Different commission tiers
    
    // Global settings
    uint256 public constant MAX_REFERRAL_LEVELS = 3; // Maximum referral levels
    uint256 public constant MAX_COMMISSION_RATE = 2000; // Maximum 20% commission
    uint256 public constant ACTIVITY_TIMEOUT = 90 days; // User considered inactive after 90 days
    uint256 public minReferralReward = 1000 * 10**18; // Minimum reward to trigger referral (1000 DVT)
    
    // Anti-gaming measures
    mapping(address => uint256) public lastReferralTime; // Prevent spam referrals
    uint256 public referralCooldown = 1 hours; // Cooldown between referrals
    
    // Statistics
    uint256 public totalReferrals;
    uint256 public totalCommissionsPaid;
    uint256 public activeReferrers;

    event UserReferred(address indexed referee, address indexed referrer, uint256 level);
    event CommissionPaid(address indexed referrer, address indexed referee, uint256 amount, uint256 level);
    event ReferralActivated(address indexed user);
    event ReferralDeactivated(address indexed user);
    event TierAdded(uint256 indexed tierId, string tierName, uint256 minReferrals, uint256 commissionRate);
    event TierUpdated(uint256 indexed tierId, uint256 minReferrals, uint256 commissionRate);
    event OperatorUpdated(address indexed operator, bool status);

    modifier onlyOperator() {
        require(operators[msg.sender] || msg.sender == owner(), "ReferralSystem: not authorized");
        _;
    }

    constructor(
        MyToken _dvt,
        address _masterChef
    ) Ownable(msg.sender) {
        require(address(_dvt) != address(0), "ReferralSystem: invalid DVT address");
        require(_masterChef != address(0), "ReferralSystem: invalid MasterChef address");
        
        dvt = _dvt;
        masterChef = _masterChef;
        
        // Initialize default commission rates for 3 levels
        levelCommissionRates = [500, 200, 100]; // 5%, 2%, 1%
        
        // Initialize default commission tiers
        _addCommissionTier("Bronze", 0, 500); // 5% for 0+ referrals
        _addCommissionTier("Silver", 5, 700); // 7% for 5+ referrals
        _addCommissionTier("Gold", 15, 1000); // 10% for 15+ referrals
        _addCommissionTier("Platinum", 50, 1500); // 15% for 50+ referrals
        
        // Set MasterChef as operator
        operators[_masterChef] = true;
    }

    /**
     * @dev Register a referral relationship
     */
    function registerReferral(address _referee, address _referrer) external onlyOperator {
        require(_referee != address(0), "ReferralSystem: invalid referee");
        require(_referrer != address(0), "ReferralSystem: invalid referrer");
        require(_referee != _referrer, "ReferralSystem: cannot refer yourself");
        require(referralInfo[_referee].referrer == address(0), "ReferralSystem: already referred");
        require(block.timestamp >= lastReferralTime[_referrer] + referralCooldown, "ReferralSystem: referral cooldown");
        
        // Check if referrer would create a circular reference
        require(!_wouldCreateCircularReference(_referee, _referrer), "ReferralSystem: circular reference");
        
        // Set up referral relationship
        referralInfo[_referee].referrer = _referrer;
        referralInfo[_referee].level = referralInfo[_referrer].level + 1;
        referralInfo[_referee].isActive = true;
        referralInfo[_referee].lastActivityTime = block.timestamp;
        
        // Update referrer's stats
        referralInfo[_referrer].totalReferred++;
        referralInfo[_referrer].isActive = true; // Make referrer active
        referralInfo[_referrer].lastActivityTime = block.timestamp;
        referredUsers[_referrer].push(_referee);
        
        // Update global stats
        totalReferrals++;
        if (referralInfo[_referrer].totalReferred == 1) {
            activeReferrers++;
        }
        
        lastReferralTime[_referrer] = block.timestamp;
        
        emit UserReferred(_referee, _referrer, referralInfo[_referee].level);
    }

    /**
     * @dev Process referral commissions when user claims rewards
     */
    function processReferralCommission(address _user, uint256 _rewardAmount) external onlyOperator nonReentrant {
        require(_user != address(0), "ReferralSystem: invalid user");
        require(_rewardAmount >= minReferralReward, "ReferralSystem: reward too small");
        
        // Update user activity
        referralInfo[_user].lastActivityTime = block.timestamp;
        
        address currentReferrer = referralInfo[_user].referrer;
        uint256 currentLevel = 1;
        
        while (currentReferrer != address(0) && currentLevel <= MAX_REFERRAL_LEVELS && currentLevel <= levelCommissionRates.length) {
            if (_isReferrerActive(currentReferrer)) {
                uint256 baseCommissionRate = levelCommissionRates[currentLevel - 1];
                uint256 tierMultiplier = _getTierCommissionRate(currentReferrer);
                uint256 finalCommissionRate = (baseCommissionRate * tierMultiplier) / 10000;
                
                // Cap the commission rate
                if (finalCommissionRate > MAX_COMMISSION_RATE) {
                    finalCommissionRate = MAX_COMMISSION_RATE;
                }
                
                uint256 commission = (_rewardAmount * finalCommissionRate) / 10000;
                
                if (commission > 0) {
                    // Mint commission to referrer
                    dvt.mint(currentReferrer, commission);
                    
                    // Update referrer stats
                    referralInfo[currentReferrer].totalEarned += commission;
                    referralInfo[currentReferrer].lastActivityTime = block.timestamp;
                    
                    // Update global stats
                    totalCommissionsPaid += commission;
                    
                    emit CommissionPaid(currentReferrer, _user, commission, currentLevel);
                }
            }
            
            // Move to next level
            currentReferrer = referralInfo[currentReferrer].referrer;
            currentLevel++;
        }
    }

    /**
     * @dev Check if referrer is active
     */
    function _isReferrerActive(address _referrer) internal view returns (bool) {
        return referralInfo[_referrer].isActive && 
               (block.timestamp - referralInfo[_referrer].lastActivityTime) <= ACTIVITY_TIMEOUT;
    }

    /**
     * @dev Get commission rate based on referrer's tier
     */
    function _getTierCommissionRate(address _referrer) internal view returns (uint256) {
        uint256 totalReferred = referralInfo[_referrer].totalReferred;
        uint256 tierRate = commissionTiers[0].commissionRate; // Default to first tier
        
        for (uint256 i = commissionTiers.length; i > 0; i--) {
            if (totalReferred >= commissionTiers[i - 1].minReferrals) {
                tierRate = commissionTiers[i - 1].commissionRate;
                break;
            }
        }
        
        return tierRate;
    }

    /**
     * @dev Check if adding referrer would create circular reference
     */
    function _wouldCreateCircularReference(address _referee, address _referrer) internal view returns (bool) {
        address current = _referrer;
        uint256 depth = 0;
        
        while (current != address(0) && depth < MAX_REFERRAL_LEVELS + 1) {
            if (current == _referee) {
                return true;
            }
            current = referralInfo[current].referrer;
            depth++;
        }
        
        return false;
    }

    /**
     * @dev Add new commission tier
     */
    function addCommissionTier(
        string memory _tierName,
        uint256 _minReferrals,
        uint256 _commissionRate
    ) external onlyOwner {
        _addCommissionTier(_tierName, _minReferrals, _commissionRate);
    }

    function _addCommissionTier(
        string memory _tierName,
        uint256 _minReferrals,
        uint256 _commissionRate
    ) internal {
        require(_commissionRate <= MAX_COMMISSION_RATE, "ReferralSystem: commission rate too high");
        
        commissionTiers.push(CommissionTier({
            minReferrals: _minReferrals,
            commissionRate: _commissionRate,
            tierName: _tierName
        }));
        
        emit TierAdded(commissionTiers.length - 1, _tierName, _minReferrals, _commissionRate);
    }

    /**
     * @dev Update commission tier
     */
    function updateCommissionTier(
        uint256 _tierId,
        uint256 _minReferrals,
        uint256 _commissionRate
    ) external onlyOwner {
        require(_tierId < commissionTiers.length, "ReferralSystem: invalid tier ID");
        require(_commissionRate <= MAX_COMMISSION_RATE, "ReferralSystem: commission rate too high");
        
        commissionTiers[_tierId].minReferrals = _minReferrals;
        commissionTiers[_tierId].commissionRate = _commissionRate;
        
        emit TierUpdated(_tierId, _minReferrals, _commissionRate);
    }

    /**
     * @dev Update level commission rates
     */
    function updateLevelCommissionRates(uint256[] memory _rates) external onlyOwner {
        require(_rates.length <= MAX_REFERRAL_LEVELS, "ReferralSystem: too many levels");
        
        for (uint256 i = 0; i < _rates.length; i++) {
            require(_rates[i] <= MAX_COMMISSION_RATE, "ReferralSystem: rate too high");
        }
        
        levelCommissionRates = _rates;
    }

    /**
     * @dev Set operator status
     */
    function setOperator(address _operator, bool _status) external onlyOwner {
        require(_operator != address(0), "ReferralSystem: invalid operator");
        operators[_operator] = _status;
        emit OperatorUpdated(_operator, _status);
    }

    /**
     * @dev Update minimum referral reward
     */
    function setMinReferralReward(uint256 _minReward) external onlyOwner {
        minReferralReward = _minReward;
    }

    /**
     * @dev Update referral cooldown
     */
    function setReferralCooldown(uint256 _cooldown) external onlyOwner {
        require(_cooldown <= 1 days, "ReferralSystem: cooldown too long");
        referralCooldown = _cooldown;
    }

    /**
     * @dev Get referral chain for a user
     */
    function getReferralChain(address _user) external view returns (address[] memory) {
        address[] memory chain = new address[](MAX_REFERRAL_LEVELS);
        address current = referralInfo[_user].referrer;
        uint256 count = 0;
        
        while (current != address(0) && count < MAX_REFERRAL_LEVELS) {
            chain[count] = current;
            current = referralInfo[current].referrer;
            count++;
        }
        
        // Resize array to actual length
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = chain[i];
        }
        
        return result;
    }

    /**
     * @dev Get referred users for a referrer
     */
    function getReferredUsers(address _referrer) external view returns (address[] memory) {
        return referredUsers[_referrer];
    }

    /**
     * @dev Get user's current tier
     */
    function getUserTier(address _user) external view returns (uint256 tierId, string memory tierName) {
        uint256 totalReferred = referralInfo[_user].totalReferred;
        
        for (uint256 i = commissionTiers.length; i > 0; i--) {
            if (totalReferred >= commissionTiers[i - 1].minReferrals) {
                return (i - 1, commissionTiers[i - 1].tierName);
            }
        }
        
        return (0, commissionTiers[0].tierName);
    }

    /**
     * @dev Get commission tiers count
     */
    function getCommissionTiersCount() external view returns (uint256) {
        return commissionTiers.length;
    }

    /**
     * @dev Get commission tier info
     */
    function getCommissionTier(uint256 _tierId) external view returns (
        string memory tierName,
        uint256 minReferrals,
        uint256 commissionRate
    ) {
        require(_tierId < commissionTiers.length, "ReferralSystem: invalid tier ID");
        CommissionTier storage tier = commissionTiers[_tierId];
        return (tier.tierName, tier.minReferrals, tier.commissionRate);
    }

    /**
     * @dev Calculate estimated commission for a reward amount
     */
    function calculateCommission(address _user, uint256 _rewardAmount) external view returns (uint256 totalCommission) {
        address currentReferrer = referralInfo[_user].referrer;
        uint256 currentLevel = 1;
        
        while (currentReferrer != address(0) && currentLevel <= MAX_REFERRAL_LEVELS && currentLevel <= levelCommissionRates.length) {
            if (_isReferrerActive(currentReferrer)) {
                uint256 baseCommissionRate = levelCommissionRates[currentLevel - 1];
                uint256 tierMultiplier = _getTierCommissionRate(currentReferrer);
                uint256 finalCommissionRate = (baseCommissionRate * tierMultiplier) / 10000;
                
                if (finalCommissionRate > MAX_COMMISSION_RATE) {
                    finalCommissionRate = MAX_COMMISSION_RATE;
                }
                
                uint256 commission = (_rewardAmount * finalCommissionRate) / 10000;
                totalCommission += commission;
            }
            
            currentReferrer = referralInfo[currentReferrer].referrer;
            currentLevel++;
        }
    }

    /**
     * @dev Emergency function to deactivate referral
     */
    function deactivateReferral(address _user) external onlyOwner {
        referralInfo[_user].isActive = false;
        emit ReferralDeactivated(_user);
    }

    /**
     * @dev Emergency function to activate referral
     */
    function activateReferral(address _user) external onlyOwner {
        referralInfo[_user].isActive = true;
        emit ReferralActivated(_user);
    }

    /**
     * @dev Get global statistics
     */
    function getGlobalStats() external view returns (
        uint256 _totalReferrals,
        uint256 _totalCommissionsPaid,
        uint256 _activeReferrers,
        uint256 _totalTiers
    ) {
        return (totalReferrals, totalCommissionsPaid, activeReferrers, commissionTiers.length);
    }

    /**
     * @dev Emergency withdraw function
     */
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        if (_token == address(0)) {
            payable(owner()).transfer(_amount);
        } else {
            IERC20(_token).safeTransfer(owner(), _amount);
        }
    }
}