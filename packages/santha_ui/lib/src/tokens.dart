// Santha design tokens for Flutter — lives in packages/santha_ui/lib/src/tokens.dart.
// Generated from design/tokens/tokens.json v1.0.0. Do not hand-edit colours; change tokens.json and regenerate.
import 'package:flutter/material.dart';

abstract final class SanthaColors {
  static const indigo = Color(0xFF1F2A5C);
  static const indigo700 = Color(0xFF16204A);
  static const indigo300 = Color(0xFF8A93B8);
  static const indigo100 = Color(0xFFE6E9F4);
  static const marigold = Color(0xFFF5A623);
  static const marigold600 = Color(0xFFD98C0F);
  static const marigold100 = Color(0xFFFDEBC8);
  static const cream = Color(0xFFFFF8EC);
  static const slate = Color(0xFF5B6478);
  static const ink = Color(0xFF1A1D29);
  static const leaf = Color(0xFF2E9E6B);
  static const chilli = Color(0xFFD9453D);
  static const sky = Color(0xFFEAF0FF);
  static const white = Color(0xFFFFFFFF);
  static const etaBg = Color(0xFFE3F4EB);
  static const onDarkMuted = Color(0xFFC9CFE3);
}

abstract final class SanthaRadius {
  static const xs = 6.0, sm = 8.0, md = 12.0, lg = 16.0, xl = 24.0, pill = 999.0;
}

abstract final class SanthaSpacing {
  static const s1 = 4.0, s2 = 8.0, s3 = 12.0, s4 = 16.0, s5 = 20.0, s6 = 24.0, s8 = 32.0, s10 = 40.0, s12 = 48.0;
}

ThemeData santhaTheme({Locale locale = const Locale('en')}) {
  final family = locale.languageCode == 'te' ? 'NotoSansTelugu' : 'Poppins';
  final scheme = ColorScheme.fromSeed(
    seedColor: SanthaColors.indigo,
    primary: SanthaColors.indigo,
    onPrimary: SanthaColors.white,
    secondary: SanthaColors.marigold,
    onSecondary: SanthaColors.indigo,
    surface: SanthaColors.white,
    onSurface: SanthaColors.ink,
    error: SanthaColors.chilli,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: SanthaColors.white,
    fontFamily: family,
    fontFamilyFallback: [locale.languageCode == 'te' ? 'Poppins' : 'NotoSansTelugu'],
    package: 'santha_ui', // fonts are bundled in packages/santha_ui
    textTheme: const TextTheme(
      displaySmall: TextStyle(fontSize: 32, height: 38 / 32, fontWeight: FontWeight.w700, color: SanthaColors.ink),
      headlineMedium: TextStyle(fontSize: 24, height: 30 / 24, fontWeight: FontWeight.w700, color: SanthaColors.ink),
      titleLarge: TextStyle(fontSize: 20, height: 26 / 20, fontWeight: FontWeight.w700, color: SanthaColors.ink),
      titleMedium: TextStyle(fontSize: 16, height: 22 / 16, fontWeight: FontWeight.w500, color: SanthaColors.ink),
      bodyMedium: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w400, color: SanthaColors.ink),
      labelLarge: TextStyle(fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w500),
      bodySmall: TextStyle(fontSize: 12, height: 16 / 12, color: SanthaColors.slate),
      labelSmall: TextStyle(fontSize: 10, height: 14 / 10, fontWeight: FontWeight.w500, color: SanthaColors.slate),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: SanthaColors.indigo,
        foregroundColor: SanthaColors.white,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg)),
        textStyle: TextStyle(fontSize: 15, fontWeight: FontWeight.w500, fontFamily: family, package: 'santha_ui'),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: SanthaColors.indigo100,
      selectedColor: SanthaColors.indigo,
      // Resolved per state: white on the indigo selected chip, indigo on the light unselected one.
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        fontFamily: family,
        package: 'santha_ui',
        color: WidgetStateColor.resolveWith((s) => s.contains(WidgetState.selected) ? SanthaColors.white : SanthaColors.indigo),
      ),
      checkmarkColor: SanthaColors.white,
      shape: const StadiumBorder(),
    ),
    cardTheme: CardThemeData(
      color: SanthaColors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(SanthaRadius.lg), side: const BorderSide(color: SanthaColors.indigo100)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: SanthaColors.indigo100,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(SanthaRadius.pill), borderSide: BorderSide.none),
      hintStyle: TextStyle(color: SanthaColors.slate, fontFamily: family, package: 'santha_ui'),
    ),
  );
}
