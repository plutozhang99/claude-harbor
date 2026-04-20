import 'package:flutter/material.dart';

import '../../theme/mistral_theme.dart';

// Three button variants from DESIGN.md §4: dark solid (default theme),
// cream surface (overridden), and ghost (text button at 40% opacity).
class ButtonRow extends StatelessWidget {
  const ButtonRow({super.key});

  @override
  Widget build(BuildContext context) {
    final TextStyle? labelLarge = Theme.of(context).textTheme.labelLarge;
    return Wrap(
      spacing: 16,
      runSpacing: 16,
      children: <Widget>[
        const ElevatedButton(
          onPressed: _noop,
          child: Text('DARK SOLID'),
        ),
        ElevatedButton(
          onPressed: _noop,
          style: ElevatedButton.styleFrom(
            backgroundColor: kCream,
            foregroundColor: kMistralBlack,
            elevation: 0,
            padding: const EdgeInsets.all(12),
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.zero,
            ),
            textStyle: labelLarge,
          ),
          child: const Text('CREAM SURFACE'),
        ),
        TextButton(
          onPressed: _noop,
          style: TextButton.styleFrom(
            backgroundColor: Colors.transparent,
            foregroundColor: kMistralBlack.withValues(alpha: 0.4),
            padding: const EdgeInsets.all(12),
            shape: const RoundedRectangleBorder(
              borderRadius: BorderRadius.zero,
            ),
            textStyle: labelLarge,
          ),
          child: const Text('GHOST'),
        ),
      ],
    );
  }
}

void _noop() {}
