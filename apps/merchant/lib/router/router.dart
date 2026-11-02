import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../features/auth/presentation/login_page.dart';
import '../features/catalogue/presentation/catalogue_page.dart';
import '../features/catalogue/presentation/import_page.dart';
import '../features/catalogue/presentation/item_form_page.dart';
import '../features/catalogue/presentation/scan_page.dart';
import '../features/catalogue/presentation/slots_page.dart';
import '../features/onboarding/presentation/onboarding_gate.dart';
import '../features/onboarding/presentation/steps.dart';

abstract final class Routes {
  static const splash = '/splash';
  static const login = '/login';
  static const home = '/';
}

/// Auth-aware router: restoring → splash, signed out → login, signed in → onboarding (M1 home).
final routerProvider = Provider<GoRouter>((ref) {
  final auth = ValueNotifier<AuthState>(ref.read(authControllerProvider));
  ref.listen(authControllerProvider, (_, next) => auth.value = next);
  ref.onDispose(auth.dispose);

  return GoRouter(
    initialLocation: Routes.home,
    refreshListenable: auth,
    redirect: (context, state) {
      final at = state.matchedLocation;
      return switch (auth.value) {
        AuthUnknown() => at == Routes.splash ? null : Routes.splash,
        AuthSignedOut() => at == Routes.login ? null : Routes.login,
        AuthSignedIn() => at == Routes.login || at == Routes.splash ? Routes.home : null,
      };
    },
    routes: [
      GoRoute(path: Routes.splash, builder: (context, state) => const _Splash()),
      GoRoute(path: Routes.login, builder: (context, state) => const LoginPage()),
      GoRoute(path: Routes.home, builder: (context, state) => const OnboardingGate()),
      GoRoute(path: '/onboarding/:step', builder: (context, state) => StepRouter(step: state.pathParameters['step']!)),
      GoRoute(path: '/catalogue', builder: (context, state) => const CataloguePage(), routes: [
        GoRoute(path: 'scan', builder: (context, state) => const ScanPage()),
        GoRoute(path: 'import', builder: (context, state) => const ImportPage()),
        GoRoute(path: 'slots', builder: (context, state) => const SlotsPage()),
        GoRoute(path: 'item/new', builder: (context, state) => ItemFormRoute(seed: state.extra as ItemFormSeed?)),
        GoRoute(path: 'item/:id', builder: (context, state) => ItemFormRoute(itemId: state.pathParameters['id'])),
      ]),
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
