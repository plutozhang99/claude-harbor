import 'package:flutter/material.dart';

import '../../theme/mistral_theme.dart';

// Demonstrates the 5-layer amber shadow cascade. The outer margin lets the
// long-offset shadow layers breathe without being clipped.
class GoldenShadowCard extends StatelessWidget {
  const GoldenShadowCard({super.key});

  @override
  Widget build(BuildContext context) {
    final TextTheme textTheme = Theme.of(context).textTheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 64),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 600),
          child: Container(
            padding: const EdgeInsets.all(32),
            decoration: const BoxDecoration(
              color: kCream,
              boxShadow: mistralGoldenShadows,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text('Warm Declaration', style: textTheme.headlineLarge),
                const SizedBox(height: 16),
                Text(
                  'Every surface glows with warmth.',
                  style: textTheme.bodyLarge,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
