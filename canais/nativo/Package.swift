// swift-tools-version: 5.9
// Parte iOS do canal "nativo", consumida pelo app via Swift Package Manager.
import PackageDescription

let package = Package(
    name: "PlataformaCanalNativo",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "PlataformaCanalNativo", targets: ["SistemaPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0")
    ],
    targets: [
        .target(
            name: "SistemaPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/SistemaPlugin"
        )
    ]
)
