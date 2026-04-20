import 'package:flutter/material.dart';

import 'showcase/block_gradient_row.dart';
import 'showcase/button_row.dart';
import 'showcase/color_swatch_grid.dart';
import 'showcase/golden_shadow_card.dart';
import 'showcase/section_label.dart';

// Breakpoint for switching horizontal padding (mobile → wider screens).
const double _tabletBreakpoint = 768;

class PaletteShowcase extends StatelessWidget {
  const PaletteShowcase({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const SectionLabel(label: 'MISTRAL PALETTE'),
      ),
      body: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          final double horizontalPadding =
              constraints.maxWidth >= _tabletBreakpoint ? 64 : 24;
          return SingleChildScrollView(
            padding: EdgeInsets.symmetric(
              horizontal: horizontalPadding,
              vertical: 32,
            ),
            child: const Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                SectionLabel(label: 'COLOR TOKENS'),
                SizedBox(height: 16),
                ColorSwatchGrid(),
                SizedBox(height: 48),
                SectionLabel(label: 'BLOCK GRADIENT'),
                SizedBox(height: 16),
                BlockGradientRow(),
                SizedBox(height: 48),
                SectionLabel(label: 'GOLDEN SHADOW CARD'),
                SizedBox(height: 16),
                GoldenShadowCard(),
                SizedBox(height: 48),
                SectionLabel(label: 'BUTTONS'),
                SizedBox(height: 16),
                ButtonRow(),
                SizedBox(height: 48),
              ],
            ),
          );
        },
      ),
    );
  }
}
