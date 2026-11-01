import 'dart:async';
import 'dart:ui';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';

const supportedSanthaLocales = [Locale('en'), Locale('te')];

final localeControllerProvider = NotifierProvider<LocaleController, Locale>(LocaleController.new);

/// App language (English / Telugu). Starts from the device language, remembers the user's choice.
class LocaleController extends Notifier<Locale> {
  static const _key = 'santha.locale';

  @override
  Locale build() {
    unawaited(_restore());
    final device = PlatformDispatcher.instance.locale.languageCode;
    return device == 'te' ? const Locale('te') : const Locale('en');
  }

  Future<void> _restore() async {
    final saved = await ref.read(keyValueStoreProvider).read(_key);
    if (saved == 'en' || saved == 'te') state = Locale(saved!);
  }

  Future<void> set(Locale locale) async {
    state = locale;
    await ref.read(keyValueStoreProvider).write(_key, locale.languageCode);
  }

  Future<void> toggle() => set(state.languageCode == 'te' ? const Locale('en') : const Locale('te'));
}
