import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:claude_harbor_frontend/main.dart';

void main() {
  testWidgets('HarborApp renders palette showcase with text', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const ProviderScope(child: HarborApp()));
    await tester.pump();

    // At least one Text widget must render — proves the theme + showcase
    // compile and the widget tree doesn't crash on mount.
    expect(find.byType(Text), findsWidgets);
  });
}
