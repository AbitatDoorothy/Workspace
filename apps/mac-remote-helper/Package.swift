// swift-tools-version: 5.10

import PackageDescription

let package = Package(
    name: "AbitatRemoteHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "AbitatRemoteHelper", targets: ["AbitatRemoteHelper"])
    ],
    targets: [
        .executableTarget(
            name: "AbitatRemoteHelper",
            path: "Sources/AbitatRemoteHelper"
        )
    ]
)
