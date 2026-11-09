// swift-tools-version: 5.9
// Parte iOS do canal "ble", consumida pelo app via Swift Package Manager.
import PackageDescription

let package = Package(
    name: "PlataformaCanalBle",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlataformaCanalBle", targets: ["CanalBlePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CanalBlePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CanalBlePlugin"
        )
    ]
)
