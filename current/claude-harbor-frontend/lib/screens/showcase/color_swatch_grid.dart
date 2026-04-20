import 'package:flutter/material.dart';

import '../../theme/mistral_theme.dart';

class _Swatch {
  const _Swatch(this.label, this.color, this.hex);
  final String label;
  final Color color;
  final String hex;
}

const List<_Swatch> _swatches = <_Swatch>[
  _Swatch('Mistral Orange', kMistralOrange, '#FA520F'),
  _Swatch('Mistral Flame', kMistralFlame, '#FB6424'),
  _Swatch('Block Orange', kBlockOrange, '#FF8105'),
  _Swatch('Sunshine 900', kSunshine900, '#FF8A00'),
  _Swatch('Sunshine 700', kSunshine700, '#FFA110'),
  _Swatch('Sunshine 500', kSunshine500, '#FFB83E'),
  _Swatch('Sunshine 300', kSunshine300, '#FFD06A'),
  _Swatch('Block Gold', kBlockGold, '#FFE295'),
  _Swatch('Bright Yellow', kBrightYellow, '#FFD900'),
  _Swatch('Warm Ivory', kWarmIvory, '#FFFAEB'),
  _Swatch('Cream', kCream, '#FFF0C2'),
  _Swatch('Mistral Black', kMistralBlack, '#1F1F1F'),
  _Swatch('Pure White', Colors.white, '#FFFFFF'),
  _Swatch('Input Border', kInputBorder, '#E5E5EB'),
];

// Explicit legibility map — dark-background swatches need ivory labels.
// Using a set is cheaper than luminance math and keeps intent explicit.
const Set<String> _ivoryLabelSwatches = <String>{
  'Mistral Orange',
  'Mistral Flame',
  'Block Orange',
  'Sunshine 900',
  'Mistral Black',
};

// Pure White needs a single warm border on a warm-ivory background so it
// reads as a tile. This is the sole place we reuse the cool-tinted border.
const Set<String> _borderedSwatches = <String>{'Pure White'};

// 4xN grid of color swatches (14 tokens — 4 cols × 4 rows with 2 empty cells).
class ColorSwatchGrid extends StatelessWidget {
  const ColorSwatchGrid({super.key});

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 4,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 120 / 80,
      children: <Widget>[
        for (final _Swatch s in _swatches) _SwatchTile(swatch: s),
      ],
    );
  }
}

class _SwatchTile extends StatelessWidget {
  const _SwatchTile({required this.swatch});

  final _Swatch swatch;

  @override
  Widget build(BuildContext context) {
    final bool useIvory = _ivoryLabelSwatches.contains(swatch.label);
    final bool bordered = _borderedSwatches.contains(swatch.label);
    return Container(
      decoration: BoxDecoration(
        color: swatch.color,
        border: bordered ? Border.all(color: kInputBorder) : null,
      ),
      padding: const EdgeInsets.all(8),
      alignment: Alignment.bottomLeft,
      child: Text(
        swatch.hex,
        style: TextStyle(
          fontFamily: 'Courier',
          fontSize: 12,
          height: 1.2,
          color: useIvory ? kWarmIvory : kMistralBlack,
          fontWeight: FontWeight.w400,
        ),
      ),
    );
  }
}
