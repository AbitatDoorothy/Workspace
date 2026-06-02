// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AbitatMacNative",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "AbitatMac", targets: ["AbitatMac"])
    ],
    targets: [
        .target(name: "AbitatMacCore"),
        .executableTarget(
            name: "AbitatMac",
            dependencies: ["AbitatMacCore"]
        ),
        .testTarget(
            name: "AbitatMacCoreTests",
            dependencies: ["AbitatMacCore"]
        ),
        .testTarget(
            name: "AbitatMacTests",
            dependencies: ["AbitatMac", "AbitatMacCore"]
        )
    ]
)
