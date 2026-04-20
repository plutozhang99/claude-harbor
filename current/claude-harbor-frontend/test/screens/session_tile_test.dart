import 'package:claude_harbor_frontend/models/session.dart';
import 'package:claude_harbor_frontend/screens/sessions/session_tile.dart';
import 'package:claude_harbor_frontend/theme/mistral_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Session _mk({
  String sessionId = 'abcdef1234',
  String? projectDir = '/Users/pluto/projects/demo',
  String? cwd,
  String status = 'active',
  double? ctxPct,
  int? ctxWindow,
  double? cost,
  String? limitsJson,
  String? modelDisplay = 'Sonnet 4.6',
  String? model = 'claude-sonnet-4-6',
}) {
  return Session(
    sessionId: sessionId,
    cwd: cwd,
    pid: null,
    projectDir: projectDir,
    accountHint: null,
    startedAt: 1,
    endedAt: null,
    endedReason: null,
    latestModel: model,
    latestModelDisplay: modelDisplay,
    latestVersion: null,
    latestPermissionMode: null,
    latestCtxPct: ctxPct,
    latestCtxWindowSize: ctxWindow,
    latestLimitsJson: limitsJson,
    latestCostUsd: cost,
    latestStatuslineAt: null,
    status: status,
  );
}

Widget _host(Session s, {VoidCallback? onTap}) {
  return MaterialApp(
    theme: mistralLightTheme,
    home: Scaffold(
      body: SessionTile(session: s, onTap: onTap ?? () {}),
    ),
  );
}

void main() {
  group('statusDotColor', () {
    test('active → Sunshine 700', () {
      expect(statusDotColor('active'), equals(kSunshine700));
    });
    test('idle → Block Gold', () {
      expect(statusDotColor('idle'), equals(kBlockGold));
    });
    test('ended → Mistral Black @ 60% (raised for contrast)', () {
      final Color c = statusDotColor('ended');
      expect(c.a, closeTo(0.6, 0.01));
      // Warm near-black base (r == g == b ≈ 0x1f / 255).
      expect(c.r, closeTo(0x1f / 255.0, 0.01));
    });
    test('unbound → Input Border (the cool-gray exception)', () {
      expect(statusDotColor('unbound'), equals(kInputBorder));
    });
    test('unknown → Input Border fallback', () {
      expect(statusDotColor('banana'), equals(kInputBorder));
    });
  });

  group('projectLabel', () {
    test('uses projectDir basename when present', () {
      expect(
        projectLabel(_mk(projectDir: '/Users/pluto/work/harbor-frontend')),
        equals('harbor-frontend'),
      );
    });
    test('falls back to cwd basename when projectDir null', () {
      expect(
        projectLabel(_mk(projectDir: null, cwd: '/tmp/demo-proj')),
        equals('demo-proj'),
      );
    });
    test('uses first 8 chars of sessionId when both dirs null', () {
      final Session s = _mk(
        sessionId: '0123456789abcdef',
        projectDir: null,
        cwd: null,
      );
      expect(projectLabel(s), equals('01234567'));
    });
  });

  group('SessionTile widget', () {
    testWidgets('hides ctx bar when latestCtxPct is null', (tester) async {
      final Session s = _mk(ctxPct: null);
      await tester.pumpWidget(_host(s));
      await tester.pump();
      // The right-aligned ctx label contains "%" and "ctx" — absent here.
      expect(find.textContaining('% \u2022'), findsNothing);
    });

    testWidgets('shows ctx bar when latestCtxPct is present', (tester) async {
      final Session s = _mk(ctxPct: 42.5, ctxWindow: 200000);
      await tester.pumpWidget(_host(s));
      await tester.pump();
      expect(find.textContaining('42%'), findsOneWidget);
      expect(find.textContaining('200000 ctx'), findsOneWidget);
    });

    testWidgets('hides cost when null, shows formatted dollar when present',
        (tester) async {
      await tester.pumpWidget(_host(_mk(cost: null)));
      await tester.pump();
      expect(find.textContaining(r'$'), findsNothing);

      await tester.pumpWidget(_host(_mk(cost: 3.456)));
      await tester.pump();
      expect(find.text(r'$3.46'), findsOneWidget);
    });

    testWidgets(r'renders $0.00 when cost is 0.0 (not hidden)', (tester) async {
      await tester.pumpWidget(_host(_mk(cost: 0.0)));
      await tester.pump();
      expect(find.text(r'$0.00'), findsOneWidget);
    });

    testWidgets('hides 5h/7d row when both rate-limit windows are absent',
        (tester) async {
      await tester.pumpWidget(_host(_mk(limitsJson: null)));
      await tester.pump();
      expect(find.textContaining('5h'), findsNothing);
      expect(find.textContaining('7d'), findsNothing);
    });

    testWidgets('renders 5h/7d row when both windows present', (tester) async {
      const String limits =
          '{"five_hour":{"used_percentage":42},"seven_day":{"used_percentage":73}}';
      await tester.pumpWidget(_host(_mk(limitsJson: limits)));
      await tester.pump();
      expect(find.text('5h 42%  \u2022  7d 73%'), findsOneWidget);
    });

    testWidgets('renders sessionId[0..8] when projectDir & cwd null',
        (tester) async {
      final Session s = _mk(
        sessionId: '0123456789abcdef',
        projectDir: null,
        cwd: null,
      );
      await tester.pumpWidget(_host(s));
      await tester.pump();
      expect(find.text('01234567'), findsOneWidget);
    });
  });
}
