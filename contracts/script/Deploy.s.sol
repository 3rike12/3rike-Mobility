// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ThreeRikeVault} from "../src/ThreeRikeVault.sol";

/// @notice Deploys the 3rike USDC yield vault to Arc.
/// @dev    Reads PRIVATE_KEY from the environment. The underlying stablecoin
///         defaults to Arc's canonical Circle USDC but can be overridden with
///         USDC_ADDRESS — the vault is stablecoin-agnostic.
contract Deploy is Script {
    // Canonical Circle USDC on Arc (ERC-20 view, 6 decimals; native gas token).
    address constant DEFAULT_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envOr("USDC_ADDRESS", DEFAULT_USDC);

        vm.startBroadcast(pk);
        ThreeRikeVault vault = new ThreeRikeVault(IERC20(usdc), deployer);
        vm.stopBroadcast();

        console.log("ThreeRikeVault deployed at:", address(vault));
        console.log("Underlying USDC:           ", usdc);
        console.log("Owner / treasury:          ", deployer);
    }
}
