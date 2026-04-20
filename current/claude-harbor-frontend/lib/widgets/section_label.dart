import 'package:flutter/material.dart';

import '../theme/mistral_theme.dart';

// Section label tracking is 0.08em — multiply by font size for absolute px.
const double kSectionLabelSize = 14;
const double kSectionLabelTracking = 0.08;

// 14px uppercase label with 0.08em letter-spacing, 60% opacity.
// Inherits `fontFamily: 'Arial'` from `Theme.of(context).textTheme.labelSmall`.
class SectionLabel extends StatelessWidget {
  const SectionLabel({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Text(
      label.toUpperCase(),
      style: Theme.of(context).textTheme.labelSmall?.copyWith(
            letterSpacing: kSectionLabelTracking * kSectionLabelSize,
            color: kMistralBlack.withValues(alpha: 0.6),
          ),
    );
  }
}
