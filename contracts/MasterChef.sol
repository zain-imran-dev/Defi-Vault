// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./MyToken.sol";

/**
 * @title MasterChef
 * @dev Staking contract for LP tokens to earn DVT rewards
 * @notice Based on SushiSwap's MasterChef with additional features
 */
contract MasterChef is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Info of each user
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided
        uint256 rewardDebt; // Reward debt
        uint256 lastHarvestTime; // Last time user harvested rewards
        uint256 lockedUntil; // Lock period end time
    }

    // Info of each pool
    struct PoolInfo {
        IERC20 lpToken; // Address of LP token contract
        uint256 allocPoint; // Allocation points assigned to this pool
        uint256 lastRewardBlock; // Last block number that DVT distribution occurs
        uint256 accDVTPerShare; // Accumulated DVT per share, times 1e12
        uint256 depositFeeBP; // Deposit fee in basis points
        uint256 harvestLockupPeriod; // Harvest lockup period in seconds
        uint256 totalStaked; // Total amount staked in this pool
    }

    MyToken public dvt; // The DVT token
    address public devAddr; // Dev address for receiving fees
    address public feeAddr; // Fee address for receiving deposit fees

    uint256 public dvtPerBlock; // DVT tokens created per block
    uint256 public constant BONUS_MULTIPLIER = 1; // Bonus multiplier for early DVT makers

    PoolInfo[] public poolInfo; // Info of each pool
    mapping(uint256 => mapping(address => UserInfo)) public userInfo; // Info of each user that stakes LP tokens

    uint256 public totalAllocPoint = 0; // Total allocation points. Must be the sum of all allocation points in all pools
    uint256 public startBlock; // The block number when DVT mining starts

    // Harvest lockup settings
    uint256 public constant MAX_HARVEST_LOCKUP = 14 days; // Maximum harvest lockup period
    
    // Fee settings
    uint256 public constant MAX_DEPOSIT_FEE = 1000; // Maximum deposit fee (10%)
    
    // Emergency withdraw settings
    bool public emergencyWithdrawEnabled = false;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event PoolAdded(uint256 indexed pid, address indexed lpToken, uint256 allocPoint, uint256 depositFeeBP);
    event PoolUpdated(uint256 indexed pid, uint256 allocPoint, uint256 depositFeeBP);
    event EmissionRateUpdated(uint256 newRate);

    constructor(
        MyToken _dvt,
        address _devAddr,
        address _feeAddr,
        uint256 _dvtPerBlock,
        uint256 _startBlock
    ) Ownable(msg.sender) {
        require(address(_dvt) != address(0), "MasterChef: invalid DVT address");
        require(_devAddr != address(0), "MasterChef: invalid dev address");
        require(_feeAddr != address(0), "MasterChef: invalid fee address");
        
        dvt = _dvt;
        devAddr = _devAddr;
        feeAddr = _feeAddr;
        dvtPerBlock = _dvtPerBlock;
        startBlock = _startBlock;
    }

    /**
     * @dev Get number of pools
     */
    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    /**
     * @dev Add a new LP token to the pool
     */
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        uint256 _depositFeeBP,
        uint256 _harvestLockupPeriod,
        bool _withUpdate
    ) external onlyOwner {
        require(address(_lpToken) != address(0), "MasterChef: invalid LP token");
        require(_depositFeeBP <= MAX_DEPOSIT_FEE, "MasterChef: deposit fee too high");
        require(_harvestLockupPeriod <= MAX_HARVEST_LOCKUP, "MasterChef: lockup period too long");
        
        // Check for duplicate LP tokens
        for (uint256 i = 0; i < poolInfo.length; i++) {
            require(address(poolInfo[i].lpToken) != address(_lpToken), "MasterChef: LP token already added");
        }
        
        if (_withUpdate) {
            massUpdatePools();
        }
        
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint += _allocPoint;
        
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accDVTPerShare: 0,
            depositFeeBP: _depositFeeBP,
            harvestLockupPeriod: _harvestLockupPeriod,
            totalStaked: 0
        }));

        emit PoolAdded(poolInfo.length - 1, address(_lpToken), _allocPoint, _depositFeeBP);
    }

    /**
     * @dev Update the given pool's DVT allocation point and deposit fee
     */
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        uint256 _depositFeeBP,
        bool _withUpdate
    ) external onlyOwner {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        require(_depositFeeBP <= MAX_DEPOSIT_FEE, "MasterChef: deposit fee too high");
        
        if (_withUpdate) {
            massUpdatePools();
        }
        
        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        poolInfo[_pid].depositFeeBP = _depositFeeBP;

        emit PoolUpdated(_pid, _allocPoint, _depositFeeBP);
    }

    /**
     * @dev Return reward multiplier over the given _from to _to block
     */
    function getMultiplier(uint256 _from, uint256 _to) public pure returns (uint256) {
        return (_to - _from) * BONUS_MULTIPLIER;
    }

    /**
     * @dev View function to see pending DVT rewards on frontend
     */
    function pendingDVT(uint256 _pid, address _user) external view returns (uint256) {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accDVTPerShare = pool.accDVTPerShare;
        uint256 lpSupply = pool.totalStaked;
        
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
            uint256 dvtReward = (multiplier * dvtPerBlock * pool.allocPoint) / totalAllocPoint;
            accDVTPerShare += (dvtReward * 1e12) / lpSupply;
        }
        
        return (user.amount * accDVTPerShare) / 1e12 - user.rewardDebt;
    }

    /**
     * @dev Update reward variables for all pools
     */
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    /**
     * @dev Update reward variables of the given pool to be up-to-date
     */
    function updatePool(uint256 _pid) public {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        
        uint256 lpSupply = pool.totalStaked;
        if (lpSupply == 0 || pool.allocPoint == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        
        uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
        uint256 dvtReward = (multiplier * dvtPerBlock * pool.allocPoint) / totalAllocPoint;
        
        // Mint rewards to MasterChef
        dvt.mint(address(this), dvtReward);
        
        // Mint 10% to dev for development fund
        dvt.mint(devAddr, dvtReward / 10);
        
        pool.accDVTPerShare += (dvtReward * 1e12) / lpSupply;
        pool.lastRewardBlock = block.number;
    }

    /**
     * @dev Deposit LP tokens to MasterChef for DVT allocation
     */
    function deposit(uint256 _pid, uint256 _amount) external nonReentrant {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        updatePool(_pid);
        
        if (user.amount > 0) {
            uint256 pending = (user.amount * pool.accDVTPerShare) / 1e12 - user.rewardDebt;
            if (pending > 0) {
                safeDVTTransfer(msg.sender, pending);
                emit Harvest(msg.sender, _pid, pending);
            }
        }
        
        if (_amount > 0) {
            uint256 balanceBefore = pool.lpToken.balanceOf(address(this));
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            uint256 actualAmount = pool.lpToken.balanceOf(address(this)) - balanceBefore;
            
            // Apply deposit fee if any
            if (pool.depositFeeBP > 0) {
                uint256 depositFee = (actualAmount * pool.depositFeeBP) / 10000;
                pool.lpToken.safeTransfer(feeAddr, depositFee);
                actualAmount -= depositFee;
            }
            
            user.amount += actualAmount;
            pool.totalStaked += actualAmount;
            
            // Set lockup period
            if (pool.harvestLockupPeriod > 0) {
                user.lockedUntil = block.timestamp + pool.harvestLockupPeriod;
            }
        }
        
        user.rewardDebt = (user.amount * pool.accDVTPerShare) / 1e12;
        user.lastHarvestTime = block.timestamp;
        
        emit Deposit(msg.sender, _pid, _amount);
    }

    /**
     * @dev Withdraw LP tokens from MasterChef
     */
    function withdraw(uint256 _pid, uint256 _amount) external nonReentrant {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "MasterChef: insufficient amount");
        
        updatePool(_pid);
        
        uint256 pending = (user.amount * pool.accDVTPerShare) / 1e12 - user.rewardDebt;
        if (pending > 0) {
            safeDVTTransfer(msg.sender, pending);
            emit Harvest(msg.sender, _pid, pending);
        }
        
        if (_amount > 0) {
            user.amount -= _amount;
            pool.totalStaked -= _amount;
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        
        user.rewardDebt = (user.amount * pool.accDVTPerShare) / 1e12;
        user.lastHarvestTime = block.timestamp;
        
        emit Withdraw(msg.sender, _pid, _amount);
    }

    /**
     * @dev Harvest rewards without withdrawing LP tokens
     */
    function harvest(uint256 _pid) external nonReentrant {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        
        // Check lockup period
        require(
            block.timestamp >= user.lockedUntil,
            "MasterChef: harvest locked"
        );
        
        updatePool(_pid);
        
        uint256 pending = (user.amount * pool.accDVTPerShare) / 1e12 - user.rewardDebt;
        require(pending > 0, "MasterChef: no pending rewards");
        
        safeDVTTransfer(msg.sender, pending);
        user.rewardDebt = (user.amount * pool.accDVTPerShare) / 1e12;
        user.lastHarvestTime = block.timestamp;
        
        // Reset lockup period
        if (pool.harvestLockupPeriod > 0) {
            user.lockedUntil = block.timestamp + pool.harvestLockupPeriod;
        }
        
        emit Harvest(msg.sender, _pid, pending);
    }

    /**
     * @dev Withdraw without caring about rewards (EMERGENCY ONLY)
     */
    function emergencyWithdraw(uint256 _pid) external nonReentrant {
        require(emergencyWithdrawEnabled, "MasterChef: emergency withdraw disabled");
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        
        user.amount = 0;
        user.rewardDebt = 0;
        user.lastHarvestTime = 0;
        user.lockedUntil = 0;
        pool.totalStaked -= amount;
        
        pool.lpToken.safeTransfer(address(msg.sender), amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    /**
     * @dev Safe DVT transfer function, just in case if rounding error causes pool to not have enough DVTs
     */
    function safeDVTTransfer(address _to, uint256 _amount) internal {
        uint256 dvtBal = dvt.balanceOf(address(this));
        bool transferSuccess = false;
        
        if (_amount > dvtBal) {
            transferSuccess = dvt.transfer(_to, dvtBal);
        } else {
            transferSuccess = dvt.transfer(_to, _amount);
        }
        
        require(transferSuccess, "MasterChef: transfer failed");
    }

    /**
     * @dev Update dev address
     */
    function setDevAddress(address _devAddr) external {
        require(msg.sender == devAddr, "MasterChef: only dev can update");
        require(_devAddr != address(0), "MasterChef: invalid address");
        devAddr = _devAddr;
    }

    /**
     * @dev Update fee address
     */
    function setFeeAddress(address _feeAddr) external {
        require(msg.sender == feeAddr, "MasterChef: only fee address can update");
        require(_feeAddr != address(0), "MasterChef: invalid address");
        feeAddr = _feeAddr;
    }

    /**
     * @dev Update emission rate
     */
    function updateEmissionRate(uint256 _dvtPerBlock) external onlyOwner {
        massUpdatePools();
        dvtPerBlock = _dvtPerBlock;
        emit EmissionRateUpdated(_dvtPerBlock);
    }

    /**
     * @dev Enable/disable emergency withdraw
     */
    function setEmergencyWithdraw(bool _enabled) external onlyOwner {
        emergencyWithdrawEnabled = _enabled;
    }

    /**
     * @dev Get user info for a specific pool
     */
    function getUserInfo(uint256 _pid, address _user) external view returns (
        uint256 amount,
        uint256 rewardDebt,
        uint256 lastHarvestTime,
        uint256 lockedUntil
    ) {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        UserInfo storage user = userInfo[_pid][_user];
        return (user.amount, user.rewardDebt, user.lastHarvestTime, user.lockedUntil);
    }

    /**
     * @dev Get pool info
     */
    function getPoolInfo(uint256 _pid) external view returns (
        address lpToken,
        uint256 allocPoint,
        uint256 lastRewardBlock,
        uint256 accDVTPerShare,
        uint256 depositFeeBP,
        uint256 harvestLockupPeriod,
        uint256 totalStaked
    ) {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        PoolInfo storage pool = poolInfo[_pid];
        return (
            address(pool.lpToken),
            pool.allocPoint,
            pool.lastRewardBlock,
            pool.accDVTPerShare,
            pool.depositFeeBP,
            pool.harvestLockupPeriod,
            pool.totalStaked
        );
    }

    /**
     * @dev Calculate APY for a pool (estimated)
     */
    function calculatePoolAPY(uint256 _pid) external view returns (uint256) {
        require(_pid < poolInfo.length, "MasterChef: invalid pool ID");
        
        PoolInfo storage pool = poolInfo[_pid];
        if (pool.totalStaked == 0 || totalAllocPoint == 0) return 0;
        
        uint256 yearlyReward = dvtPerBlock * 10512000; // Assuming 3 sec blocks (2102400 blocks/year * 5)
        uint256 poolYearlyReward = (yearlyReward * pool.allocPoint) / totalAllocPoint;
        
        // This is a simplified APY calculation
        // In practice, you'd want to use token prices for accurate calculation
        return (poolYearlyReward * 100) / pool.totalStaked;
    }
}