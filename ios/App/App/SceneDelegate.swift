import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        #if targetEnvironment(macCatalyst)
        // Mac: a window big enough for the piano roll, keyboard and side panels
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 1100, height: 760)
        windowScene.titlebar?.titleVisibility = .hidden
        #endif
        window?.rootViewController = PianoooBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)

        // Launched by opening a file (Safari, Files, AirDrop …)
        for context in connectionOptions.urlContexts { PianoooFilesPlugin.handle(context.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts { PianoooFilesPlugin.handle(context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
