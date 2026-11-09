// swift-tools-version: 5.9
// Parte iOS do canal "morse", consumida pelo app via Swift Package Manager.
import PackageDescription

let package = Package(
    name: "PlataformaCanalMorse",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlataformaCanalMorse", targets: ["LanternaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "LanternaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/LanternaPlugin"
        )
    ]
)
