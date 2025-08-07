// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title LiquidityPool
 * @dev Simple AMM pool using constant product formula (x * y = k)
 * @notice Allows swapping between BNB and DVT tokens
 */
contract LiquidityPool is ERC20, Ownable, ReentrancyGuard {
    IERC20 public immutable token; // DVT token
    
    uint256 public constant MINIMUM_LIQUIDITY = 10**3;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public swapFee = 30; // 0.3% default fee
    
    uint256 public protocolFeeShare = 2000; // 20% of fees go to protocol
    address public feeRecipient;
    
    uint256 public reserveETH;
    uint256 public reserveToken;
    uint256 public kLast; // Last known k value for fee calculation
    
    // Price impact protection
    uint256 public maxPriceImpact = 1000; // 10% max price impact
    
    event Mint(address indexed sender, uint256 amountETH, uint256 amountToken);
    event Burn(address indexed sender, uint256 amountETH, uint256 amountToken, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amountETHIn,
        uint256 amountTokenIn,
        uint256 amountETHOut,
        uint256 amountTokenOut,
        address indexed to
    );
    event Sync(uint256 reserveETH, uint256 reserveToken);
    event SwapFeeUpdated(uint256 newFee);
    event ProtocolFeeShareUpdated(uint256 newShare);
    event FeeRecipientUpdated(address newRecipient);

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "LiquidityPool: EXPIRED");
        _;
    }

    constructor(
        address _token,
        address _feeRecipient
    ) ERC20("DVT-BNB LP", "DVT-LP") Ownable(msg.sender) {
        require(_token != address(0), "LiquidityPool: invalid token address");
        require(_feeRecipient != address(0), "LiquidityPool: invalid fee recipient");
        
        token = IERC20(_token);
        feeRecipient = _feeRecipient;
    }

    /**
     * @dev Add liquidity to the pool
     */
    function addLiquidity(
        uint256 tokenAmountDesired,
        uint256 tokenAmountMin,
        uint256 ethAmountMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) nonReentrant returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(to != address(0), "LiquidityPool: invalid recipient");
        
        (amountToken, amountETH) = _addLiquidity(tokenAmountDesired, msg.value, tokenAmountMin, ethAmountMin);
        
        address pair = address(this);
        token.transferFrom(msg.sender, pair, amountToken);
        
        liquidity = mint(to);
        
        // Refund excess ETH
        if (msg.value > amountETH) {
            payable(msg.sender).transfer(msg.value - amountETH);
        }
    }

    /**
     * @dev Remove liquidity from the pool
     */
    function removeLiquidity(
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256 amountToken, uint256 amountETH) {
        require(to != address(0), "LiquidityPool: invalid recipient");
        
        transfer(address(this), liquidity); // Transfer LP tokens to this contract
        (amountETH, amountToken) = burn(to);
        
        require(amountToken >= amountTokenMin, "LiquidityPool: INSUFFICIENT_TOKEN_AMOUNT");
        require(amountETH >= amountETHMin, "LiquidityPool: INSUFFICIENT_ETH_AMOUNT");
    }

    /**
     * @dev Swap exact ETH for tokens
     */
    function swapExactETHForTokens(
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external payable ensure(deadline) nonReentrant returns (uint256 amountOut) {
        require(msg.value > 0, "LiquidityPool: INSUFFICIENT_INPUT_AMOUNT");
        require(to != address(0), "LiquidityPool: invalid recipient");
        
        uint256 amountIn = msg.value;
        amountOut = getAmountOut(amountIn, reserveETH, reserveToken);
        require(amountOut >= amountOutMin, "LiquidityPool: INSUFFICIENT_OUTPUT_AMOUNT");
        
        // Check price impact
        uint256 priceImpact = (amountIn * FEE_DENOMINATOR) / reserveETH;
        require(priceImpact <= maxPriceImpact, "LiquidityPool: PRICE_IMPACT_TOO_HIGH");
        
        _swap(amountIn, 0, 0, amountOut, to);
    }

    /**
     * @dev Swap exact tokens for ETH
     */
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        address to,
        uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256 amountOut) {
        require(amountIn > 0, "LiquidityPool: INSUFFICIENT_INPUT_AMOUNT");
        require(to != address(0), "LiquidityPool: invalid recipient");
        
        amountOut = getAmountOut(amountIn, reserveToken, reserveETH);
        require(amountOut >= amountOutMin, "LiquidityPool: INSUFFICIENT_OUTPUT_AMOUNT");
        
        // Check price impact
        uint256 priceImpact = (amountIn * FEE_DENOMINATOR) / reserveToken;
        require(priceImpact <= maxPriceImpact, "LiquidityPool: PRICE_IMPACT_TOO_HIGH");
        
        token.transferFrom(msg.sender, address(this), amountIn);
        _swap(0, amountIn, amountOut, 0, to);
    }

    /**
     * @dev Internal function to add liquidity
     */
    function _addLiquidity(
        uint256 tokenAmountDesired,
        uint256 ethAmountDesired,
        uint256 tokenAmountMin,
        uint256 ethAmountMin
    ) internal view returns (uint256 amountToken, uint256 amountETH) {
        if (reserveETH == 0 && reserveToken == 0) {
            (amountToken, amountETH) = (tokenAmountDesired, ethAmountDesired);
        } else {
            uint256 ethAmountOptimal = quote(tokenAmountDesired, reserveToken, reserveETH);
            if (ethAmountOptimal <= ethAmountDesired) {
                require(ethAmountOptimal >= ethAmountMin, "LiquidityPool: INSUFFICIENT_ETH_AMOUNT");
                (amountToken, amountETH) = (tokenAmountDesired, ethAmountOptimal);
            } else {
                uint256 tokenAmountOptimal = quote(ethAmountDesired, reserveETH, reserveToken);
                require(tokenAmountOptimal <= tokenAmountDesired, "LiquidityPool: INVALID_TOKEN_AMOUNT");
                require(tokenAmountOptimal >= tokenAmountMin, "LiquidityPool: INSUFFICIENT_TOKEN_AMOUNT");
                (amountToken, amountETH) = (tokenAmountOptimal, ethAmountDesired);
            }
        }
    }

    /**
     * @dev Mint LP tokens
     */
    function mint(address to) internal returns (uint256 liquidity) {
        uint256 balanceETH = address(this).balance;
        uint256 balanceToken = token.balanceOf(address(this));
        uint256 amountETH = balanceETH - reserveETH;
        uint256 amountToken = balanceToken - reserveToken;

        uint256 _totalSupply = totalSupply();
        if (_totalSupply == 0) {
            liquidity = Math.sqrt(amountETH * amountToken) - MINIMUM_LIQUIDITY;
            _mint(address(1), MINIMUM_LIQUIDITY); // Lock minimum liquidity to dead address
        } else {
            liquidity = Math.min(
                (amountETH * _totalSupply) / reserveETH,
                (amountToken * _totalSupply) / reserveToken
            );
        }
        
        require(liquidity > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY_MINTED");
        _mint(to, liquidity);

        _update(balanceETH, balanceToken);
        kLast = reserveETH * reserveToken;
        
        emit Mint(msg.sender, amountETH, amountToken);
    }

    /**
     * @dev Burn LP tokens
     */
    function burn(address to) internal returns (uint256 amountETH, uint256 amountToken) {
        uint256 balanceETH = address(this).balance;
        uint256 balanceToken = token.balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));

        uint256 _totalSupply = totalSupply();
        amountETH = (liquidity * balanceETH) / _totalSupply;
        amountToken = (liquidity * balanceToken) / _totalSupply;
        
        require(amountETH > 0 && amountToken > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY_BURNED");
        
        _burn(address(this), liquidity);
        token.transfer(to, amountToken);
        payable(to).transfer(amountETH);

        balanceETH = address(this).balance;
        balanceToken = token.balanceOf(address(this));

        _update(balanceETH, balanceToken);
        kLast = reserveETH * reserveToken;
        
        emit Burn(msg.sender, amountETH, amountToken, to);
    }

    /**
     * @dev Internal swap function
     */
    function _swap(uint256 amountETHIn, uint256 amountTokenIn, uint256 amountETHOut, uint256 amountTokenOut, address to) internal {
        require(amountETHOut > 0 || amountTokenOut > 0, "LiquidityPool: INSUFFICIENT_OUTPUT_AMOUNT");
        require(amountETHOut < reserveETH && amountTokenOut < reserveToken, "LiquidityPool: INSUFFICIENT_LIQUIDITY");

        uint256 balanceETH;
        uint256 balanceToken;
        
        if (amountTokenOut > 0) token.transfer(to, amountTokenOut);
        if (amountETHOut > 0) payable(to).transfer(amountETHOut);
        
        balanceETH = address(this).balance;
        balanceToken = token.balanceOf(address(this));

        uint256 amountETHInWithFee = amountETHIn * (FEE_DENOMINATOR - swapFee);
        uint256 amountTokenInWithFee = amountTokenIn * (FEE_DENOMINATOR - swapFee);
        
        require(
            balanceETH * FEE_DENOMINATOR >= (reserveETH - amountETHOut) * FEE_DENOMINATOR + amountETHInWithFee &&
            balanceToken * FEE_DENOMINATOR >= (reserveToken - amountTokenOut) * FEE_DENOMINATOR + amountTokenInWithFee,
            "LiquidityPool: K"
        );

        _update(balanceETH, balanceToken);
        emit Swap(msg.sender, amountETHIn, amountTokenIn, amountETHOut, amountTokenOut, to);
    }

    /**
     * @dev Update reserves
     */
    function _update(uint256 balanceETH, uint256 balanceToken) private {
        reserveETH = balanceETH;
        reserveToken = balanceToken;
        emit Sync(reserveETH, reserveToken);
    }

    /**
     * @dev Get amount out for a given input
     */
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view returns (uint256 amountOut) {
        require(amountIn > 0, "LiquidityPool: INSUFFICIENT_INPUT_AMOUNT");
        require(reserveIn > 0 && reserveOut > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY");
        
        uint256 amountInWithFee = amountIn * (FEE_DENOMINATOR - swapFee);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = reserveIn * FEE_DENOMINATOR + amountInWithFee;
        amountOut = numerator / denominator;
    }

    /**
     * @dev Quote function for liquidity provision
     */
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256 amountB) {
        require(amountA > 0, "LiquidityPool: INSUFFICIENT_AMOUNT");
        require(reserveA > 0 && reserveB > 0, "LiquidityPool: INSUFFICIENT_LIQUIDITY");
        amountB = (amountA * reserveB) / reserveA;
    }

    /**
     * @dev Get current price (token per ETH)
     */
    function getPrice() external view returns (uint256) {
        if (reserveETH == 0) return 0;
        return (reserveToken * 1e18) / reserveETH;
    }

    /**
     * @dev Set swap fee (owner only)
     */
    function setSwapFee(uint256 _swapFee) external onlyOwner {
        require(_swapFee <= 1000, "LiquidityPool: fee too high"); // Max 10%
        swapFee = _swapFee;
        emit SwapFeeUpdated(_swapFee);
    }

    /**
     * @dev Set protocol fee share (owner only)
     */
    function setProtocolFeeShare(uint256 _protocolFeeShare) external onlyOwner {
        require(_protocolFeeShare <= 5000, "LiquidityPool: fee share too high"); // Max 50%
        protocolFeeShare = _protocolFeeShare;
        emit ProtocolFeeShareUpdated(_protocolFeeShare);
    }

    /**
     * @dev Set fee recipient (owner only)
     */
    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "LiquidityPool: invalid fee recipient");
        feeRecipient = _feeRecipient;
        emit FeeRecipientUpdated(_feeRecipient);
    }

    /**
     * @dev Set max price impact (owner only)
     */
    function setMaxPriceImpact(uint256 _maxPriceImpact) external onlyOwner {
        require(_maxPriceImpact <= 5000, "LiquidityPool: price impact too high"); // Max 50%
        maxPriceImpact = _maxPriceImpact;
    }

    /**
     * @dev Get reserves
     */
    function getReserves() external view returns (uint256 _reserveETH, uint256 _reserveToken) {
        _reserveETH = reserveETH;
        _reserveToken = reserveToken;
    }

    /**
     * @dev Emergency function to recover tokens (owner only)
     */
    function emergencyWithdraw(address tokenAddress, uint256 amount) external onlyOwner {
        if (tokenAddress == address(0)) {
            payable(owner()).transfer(amount);
        } else {
            IERC20(tokenAddress).transfer(owner(), amount);
        }
    }

    receive() external payable {}
}