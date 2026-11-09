// swift-tools-version: 5.9
// Parte iOS do canal "radio", consumida pelo app via Swift Package Manager.
import PackageDescription

let package = Package(
    name: "PlataformaCanalRadio",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlataformaCanalRadio", targets: ["CanalRadioPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "CanalRadioPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/CanalRadioPlugin"
        )
    ]
)
