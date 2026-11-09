// swift-tools-version: 5.9
// Parte iOS do canal "wifi", consumida pelo app via Swift Package Manager.
import PackageDescription

let package = Package(
    name: "PlataformaCanalWifi",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlataformaCanalWifi", targets: ["CanalWifiPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CanalWifiPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CanalWifiPlugin"
        )
    ]
)
