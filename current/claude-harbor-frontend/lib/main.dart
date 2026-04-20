import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/session_list_screen.dart';
import 'theme/mistral_theme.dart';

void main() {
  runApp(const ProviderScope(child: HarborApp()));
}

class HarborApp extends StatelessWidget {
  const HarborApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Claude Harbor',
      debugShowCheckedModeBanner: false,
      theme: mistralLightTheme,
      home: const SessionListScreen(),
    );
  }
}
