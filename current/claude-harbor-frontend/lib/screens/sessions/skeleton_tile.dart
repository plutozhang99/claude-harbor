import 'package:flutter/material.dart';

import '../../theme/mistral_theme.dart';

// A single loading-state tile. Muted cream rectangle + a thin gold accent bar
// in place of the title — no animation, no shimmer libraries.
class SkeletonTile extends StatelessWidget {
  const SkeletonTile({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: kCream,
      height: 96,
      padding: const EdgeInsets.all(16),
      child: Align(
        alignment: Alignment.topLeft,
        child: FractionallySizedBox(
          widthFactor: 0.4,
          child: Container(
            height: 10,
            color: kBlockGold,
          ),
        ),
      ),
    );
  }
}

// A column of N skeleton tiles separated the same way the real list is.
class SkeletonList extends StatelessWidget {
  const SkeletonList({this.count = 3, super.key});

  final int count;

  @override
  Widget build(BuildContext context) {
    final List<Widget> children = <Widget>[];
    for (int i = 0; i < count; i++) {
      if (i > 0) {
        children.add(const SizedBox(height: 1, child: ColoredBox(color: kInputBorder)));
      }
      children.add(const SkeletonTile());
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    );
  }
}
