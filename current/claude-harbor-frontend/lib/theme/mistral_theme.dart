import 'package:flutter/material.dart';

// ---------------------------------------------------------------------------
// Color tokens — the Mistral warm palette. See docs/DESIGN.md.
// ---------------------------------------------------------------------------

const Color kMistralOrange = Color(0xFFFA520F);
const Color kMistralFlame = Color(0xFFFB6424);
const Color kBlockOrange = Color(0xFFFF8105);
const Color kSunshine900 = Color(0xFFFF8A00);
const Color kSunshine700 = Color(0xFFFFA110);
const Color kSunshine500 = Color(0xFFFFB83E);
const Color kSunshine300 = Color(0xFFFFD06A);
const Color kBlockGold = Color(0xFFFFE295);
const Color kBrightYellow = Color(0xFFFFD900);
const Color kWarmIvory = Color(0xFFFFFAEB);
const Color kCream = Color(0xFFFFF0C2);
const Color kMistralBlack = Color(0xFF1F1F1F);

// hsl(240, 5.9%, 90%) ≈ #E5E5EB — the sole cool-tinted element (form borders).
const Color kInputBorder = Color(0xFFE5E5EB);

// Warm red for error states — NOT a cool red.
const Color kWarmError = Color(0xFFB3311F);

// ---------------------------------------------------------------------------
// Golden shadow cascade — five amber-tinted layers approximating the CSS
// shadow stack from DESIGN.md §6. Consumers apply this as `boxShadow` on a
// Container since CardTheme cannot chain multiple shadows.
// ---------------------------------------------------------------------------

const List<BoxShadow> mistralGoldenShadows = <BoxShadow>[
  BoxShadow(
    color: Color(0x1F7F6315), // rgba(127, 99, 21, 0.12)
    offset: Offset(-8, 16),
    blurRadius: 39,
  ),
  BoxShadow(
    color: Color(0x1A7F6315), // rgba(127, 99, 21, 0.10)
    offset: Offset(-33, 64),
    blurRadius: 72,
  ),
  BoxShadow(
    color: Color(0x0F7F6315), // rgba(127, 99, 21, 0.06)
    offset: Offset(-73, 144),
    blurRadius: 97,
  ),
  BoxShadow(
    color: Color(0x087F6315), // rgba(127, 99, 21, 0.03)
    offset: Offset(-130, 257),
    blurRadius: 136,
  ),
  BoxShadow(
    color: Color(0x037F6315), // rgba(127, 99, 21, 0.01)
    offset: Offset(-203, 400),
    blurRadius: 160,
  ),
];

// ---------------------------------------------------------------------------
// Text theme — weight 400 everywhere, size carries hierarchy.
// ---------------------------------------------------------------------------

const TextStyle _baseText = TextStyle(
  fontWeight: FontWeight.w400,
  color: kMistralBlack,
);

TextTheme _buildTextTheme() {
  return const TextTheme(
    displayLarge: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 82,
      height: 1.00,
      letterSpacing: -2.05,
    ),
    displayMedium: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 56,
      height: 0.95,
    ),
    displaySmall: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 48,
      height: 0.95,
    ),
    headlineLarge: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 32,
      height: 1.15,
    ),
    headlineMedium: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 30,
      height: 1.20,
    ),
    headlineSmall: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 24,
      height: 1.33,
    ),
    bodyLarge: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 16,
      height: 1.5,
    ),
    bodyMedium: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 16,
      height: 1.5,
    ),
    labelLarge: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 16,
      height: 1.5,
    ),
    bodySmall: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 14,
      height: 1.43,
    ),
    labelSmall: TextStyle(
      fontWeight: FontWeight.w400,
      color: kMistralBlack,
      fontSize: 14,
      height: 1.43,
    ),
  );
}

// ---------------------------------------------------------------------------
// Button shape — sharp corners everywhere.
// ---------------------------------------------------------------------------

const RoundedRectangleBorder _sharpBorder = RoundedRectangleBorder(
  borderRadius: BorderRadius.zero,
);

ElevatedButtonThemeData _buildElevatedButtonTheme() {
  return ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: kMistralBlack,
      foregroundColor: Colors.white,
      elevation: 0,
      padding: const EdgeInsets.all(12),
      shape: _sharpBorder,
      textStyle: _baseText.copyWith(fontSize: 16, height: 1.5),
    ),
  );
}

TextButtonThemeData _buildTextButtonTheme() {
  return TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: kMistralBlack,
      padding: const EdgeInsets.all(12),
      shape: _sharpBorder,
      textStyle: _baseText.copyWith(fontSize: 16, height: 1.5),
    ),
  );
}

OutlinedButtonThemeData _buildOutlinedButtonTheme() {
  return OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: kMistralBlack,
      padding: const EdgeInsets.all(12),
      shape: _sharpBorder,
      side: const BorderSide(color: kMistralBlack),
      textStyle: _baseText.copyWith(fontSize: 16, height: 1.5),
    ),
  );
}

// ---------------------------------------------------------------------------
// Input decoration — the sole cool-tinted element, per DESIGN.md.
// ---------------------------------------------------------------------------

InputDecorationTheme _buildInputDecorationTheme() {
  return const InputDecorationTheme(
    border: OutlineInputBorder(
      borderRadius: BorderRadius.zero,
      borderSide: BorderSide(color: kInputBorder),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.zero,
      borderSide: BorderSide(color: kInputBorder),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.zero,
      borderSide: BorderSide(color: kMistralOrange),
    ),
  );
}

// ---------------------------------------------------------------------------
// ThemeData — Material 3, seeded from Mistral Orange then overridden.
// Every role is pinned to a warm token; no derived cool tones leak through.
// ---------------------------------------------------------------------------

// Amber-tinted shadow base from the golden shadows spec (rgb(127,99,21)).
const Color _kAmberShadow = Color(0xFF7F6315);
// Very pale warm surface for tertiary container.
const Color _kTertiaryContainer = Color(0xFFFFF4D6);
// Warm derivative of kInputBorder for M3 outlineVariant.
const Color _kOutlineVariantWarm = Color(0xFFF0E4C8);

ThemeData _buildMistralLightTheme() {
  final ColorScheme base = ColorScheme.fromSeed(
    seedColor: kMistralOrange,
    brightness: Brightness.light,
  );

  final ColorScheme scheme = base.copyWith(
    primary: kMistralOrange,
    onPrimary: Colors.white,
    surface: kWarmIvory,
    onSurface: kMistralBlack,
    surfaceContainerLowest: kWarmIvory,
    surfaceContainer: kCream,
    surfaceContainerHigh: kCream,
    outline: kInputBorder,
    error: kWarmError,
    onError: Colors.white,
    // Pin remaining roles to warm tokens so M3 tone-mapping can't leak cools.
    secondary: kSunshine700,
    onSecondary: Colors.white,
    secondaryContainer: kCream,
    onSecondaryContainer: kMistralBlack,
    tertiary: kBlockGold,
    onTertiary: kMistralBlack,
    tertiaryContainer: _kTertiaryContainer,
    onTertiaryContainer: kMistralBlack,
    inversePrimary: kBlockGold,
    inverseSurface: kMistralBlack,
    onInverseSurface: kWarmIvory,
    shadow: _kAmberShadow,
    scrim: _kAmberShadow,
    outlineVariant: _kOutlineVariantWarm,
    surfaceTint: kMistralOrange,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Arial',
    fontFamilyFallback: const ['NotoSansSC', 'NotoEmoji'],
    scaffoldBackgroundColor: kWarmIvory,
    textTheme: _buildTextTheme(),
    elevatedButtonTheme: _buildElevatedButtonTheme(),
    textButtonTheme: _buildTextButtonTheme(),
    outlinedButtonTheme: _buildOutlinedButtonTheme(),
    inputDecorationTheme: _buildInputDecorationTheme(),
    cardTheme: const CardThemeData(
      color: kWarmIvory,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.zero),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: kWarmIvory,
      foregroundColor: kMistralBlack,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: kWarmIvory,
    ),
  );
}

// M3. Built once at import time — `ColorScheme.fromSeed` is not cheap.
final ThemeData mistralLightTheme = _buildMistralLightTheme();
