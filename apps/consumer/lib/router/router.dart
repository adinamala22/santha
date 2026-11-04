import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../data/providers.dart';
import '../features/auth/presentation/login_page.dart';
import '../features/home/presentation/home_page.dart';
import '../features/home/presentation/shell.dart';
import '../features/location/location_controller.dart';
import '../features/location/location_page.dart';
import '../features/location/map_pin_page.dart';
import '../features/search/search_page.dart';
import '../features/store/store_page.dart';
import '../features/cart/cart_page.dart';
import '../features/checkout/checkout_page.dart';
import '../features/orders/orders_page.dart';

abstract final class Routes {
  static const splash = '/splash';
  static const login = '/login';
  static const location = '/location';
  static const home = '/';
}

/// Auth- and location-aware router: restoring → splash, signed out → login, no delivery location
/// yet → location picker, otherwise the tabbed home.
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AuthState>(ref.read(authControllerProvider));
  final location = ValueNotifier<LocationState>(ref.read(locationControllerProvider));
  ref.listen(authControllerProvider, (_, next) => auth.value = next);
  ref.listen(locationControllerProvider, (_, next) => location.value = next);
  ref.onDispose(auth.dispose);
  ref.onDispose(location.dispose);

  return GoRouter(
    initialLocation: Routes.home,
    refreshListenable: Listenable.merge([auth, location]),
    redirect: (context, state) {
      final at = state.matchedLocation;
      switch (auth.value) {
        case AuthUnknown():
          return at == Routes.splash ? null : Routes.splash;
        case AuthSignedOut():
          return at == Routes.login ? null : Routes.login;
        case AuthSignedIn():
          return switch (location.value) {
            LocationRestoring() => at == Routes.splash ? null : Routes.splash,
            LocationUnset() => at.startsWith(Routes.location) ? null : Routes.location,
            LocationSet() => at == Routes.login || at == Routes.splash ? Routes.home : null,
          };
      }
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (context, state) => const _Splash()),
      GoRoute(path: Routes.login, builder: (context, state) => const LoginPage()),
      GoRoute(
        path: Routes.location,
        builder: (context, state) => const LocationPage(),
        routes: [GoRoute(path: 'pin', builder: (context, state) => MapPinPage(fix: state.extra is Located ? state.extra! as Located : null))],
      ),
      GoRoute(path: '/cart', builder: (context, state) => const CartPage()),
      GoRoute(path: '/checkout', builder: (context, state) => const CheckoutPage()),
      GoRoute(
        path: '/orders/:id',
        builder: (context, state) => OrderDetailPage(id: state.pathParameters['id']!, justPlaced: state.uri.queryParameters['placed'] == '1'),
      ),
      GoRoute(
        path: '/store/:id',
        builder: (context, state) => StorePageScreen(id: state.pathParameters['id']!, openItemId: state.uri.queryParameters['item']),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => HomeShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: Routes.home, builder: (context, state) => const HomePage())]),
          StatefulShellBranch(routes: [
            GoRoute(
              path: '/search',
              builder: (context, state) => SearchPage(
                initialQuery: state.uri.queryParameters['q'] ?? '',
                category: state.uri.queryParameters['category'],
              ),
            ),
          ]),
          StatefulShellBranch(routes: [GoRoute(path: '/orders', builder: (context, state) => const OrdersPage())]),
          StatefulShellBranch(routes: [GoRoute(path: '/account', builder: (context, state) => const AccountPage())]),
        ],
      ),
    ],
  );
});

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: SanthaColors.indigo,
        body: Center(child: SanthaLogo.reverse(width: 200)),
      );
}
