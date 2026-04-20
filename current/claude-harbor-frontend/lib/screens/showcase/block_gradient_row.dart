import 'package:flutter/material.dart';

import '../../theme/mistral_theme.dart';

// The signature "M block" — yellow → amber → orange. Sharp corners, zero gaps.
const List<Color> _blockColors = <Color>[
  kBrightYellow,
  kBlockGold,
  kSunshine700,
  kBlockOrange,
  kMistralFlame,
  kMistralOrange,
];

class BlockGradientRow extends StatelessWidget {
  const BlockGradientRow({super.key});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 48,
      child: Row(
        children: <Widget>[
          for (final Color c in _blockColors)
            Expanded(child: ColoredBox(color: c, child: const SizedBox.expand())),
        ],
      ),
    );
  }
}
