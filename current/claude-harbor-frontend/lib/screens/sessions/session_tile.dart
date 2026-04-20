import 'package:flutter/material.dart';
import 'package:path/path.dart' as p;

import '../../models/rate_limits.dart';
import '../../models/session.dart';
import '../../theme/mistral_theme.dart';

const TextStyle _courier = TextStyle(
  fontFamily: 'Courier',
  fontSize: 14,
  height: 1.43,
  fontWeight: FontWeight.w400,
  color: kMistralBlack,
);

// Status → status-dot color. All warm tokens; kInputBorder is the only cool
// tone and is reserved for `unbound`/unknown (consistent with DESIGN.md).
Color statusDotColor(String status) {
  switch (status) {
    case 'active':
      return kSunshine700;
    case 'idle':
      return kBlockGold;
    case 'ended':
      // Raised from 0.4 → 0.6 for better contrast against kWarmIvory.
      return kMistralBlack.withValues(alpha: 0.6);
    case 'unbound':
      return kInputBorder;
    default:
      return kInputBorder;
  }
}

// Human-readable status label used by Tooltip + Semantics so the state is
// conveyed beyond just the dot color.
String statusLabel(String status) {
  switch (status) {
    case 'active':
      return 'Active';
    case 'idle':
      return 'Idle';
    case 'ended':
      return 'Ended';
    case 'unbound':
      return 'Unbound';
    default:
      return 'Unknown';
  }
}

// Project basename — last path component of project_dir or cwd, or a
// truncated session id when both are missing.
String projectLabel(Session s) {
  final String? src = s.projectDir ?? s.cwd;
  if (src != null && src.isNotEmpty) {
    final String base = p.basename(src);
    if (base.isNotEmpty) return base;
  }
  if (s.sessionId.isEmpty) return '\u2014';
  if (s.sessionId.length >= 8) {
    return s.sessionId.substring(0, 8);
  }
  return s.sessionId;
}

class SessionTile extends StatelessWidget {
  const SessionTile({
    required this.session,
    required this.onTap,
    super.key,
  });

  final Session session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Session s = session;
    final String title = projectLabel(s);
    final String model =
        s.latestModelDisplay ?? s.latestModel ?? '\u2014'; // em-dash fallback
    final String semanticLabel =
        '$title, status ${statusLabel(s.status)}, model $model';

    return Semantics(
      button: true,
      label: semanticLabel,
      child: Material(
        color: kWarmIvory,
        // Sharp-edged bottom separator — replicates previous border rendering
        // while letting InkWell.customBorder clip the ripple to the same shape.
        shape: const Border(
          bottom: BorderSide(color: kInputBorder, width: 1),
        ),
        child: InkWell(
          onTap: onTap,
          customBorder: const RoundedRectangleBorder(
            borderRadius: BorderRadius.zero,
          ),
          splashColor: kBlockGold.withValues(alpha: 0.4),
          highlightColor: kBlockGold.withValues(alpha: 0.2),
          overlayColor: WidgetStateProperty.resolveWith<Color?>(
            (Set<WidgetState> states) {
              if (states.contains(WidgetState.hovered) ||
                  states.contains(WidgetState.focused) ||
                  states.contains(WidgetState.pressed)) {
                return kCream;
              }
              return null;
            },
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 16,
              ),
              child: MergeSemantics(
                child: _TileContent(session: s, title: title, model: model),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// Tile content extracted as stateless so hover-driven overlay rebuilds don't
// redraw the content subtree.
class _TileContent extends StatelessWidget {
  const _TileContent({
    required this.session,
    required this.title,
    required this.model,
  });

  final Session session;
  final String title;
  final String model;

  @override
  Widget build(BuildContext context) {
    final TextTheme t = Theme.of(context).textTheme;
    final Session s = session;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        _HeaderRow(session: s, title: title, model: model, textTheme: t),
        const SizedBox(height: 8),
        if (s.latestCtxPct != null) ...<Widget>[
          _CtxBar(
            pct: s.latestCtxPct!,
            windowSize: s.latestCtxWindowSize,
            textStyle: t.bodySmall,
          ),
          const SizedBox(height: 6),
        ],
        _LimitsRow(session: s, textTheme: t),
      ],
    );
  }
}

class _HeaderRow extends StatelessWidget {
  const _HeaderRow({
    required this.session,
    required this.title,
    required this.model,
    required this.textTheme,
  });

  final Session session;
  final String title;
  final String model;
  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    final Session s = session;
    final String status = statusLabel(s.status);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Padding(
          // Align the status square to the cap-height of the 48px title.
          padding: const EdgeInsets.only(top: 18, right: 12),
          child: Tooltip(
            message: status,
            child: Semantics(
              label: 'Status: $status',
              child: Container(
                width: 12,
                height: 12,
                color: statusDotColor(s.status),
              ),
            ),
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                title,
                style: textTheme.displaySmall, // 48px, weight 400
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),
              Text(
                model,
                style: textTheme.bodyLarge?.copyWith(
                  color: kMistralBlack.withValues(alpha: 0.75),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        if (s.latestCostUsd != null) ...<Widget>[
          const SizedBox(width: 12),
          Padding(
            padding: const EdgeInsets.only(top: 14),
            child: Text(
              '\$${s.latestCostUsd!.toStringAsFixed(2)}',
              style: _courier,
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ],
    );
  }
}

class _LimitsRow extends StatelessWidget {
  const _LimitsRow({required this.session, required this.textTheme});

  final Session session;
  final TextTheme textTheme;

  @override
  Widget build(BuildContext context) {
    final RateLimits? rl = session.rateLimits;
    final double? fh = rl?.fiveHour?.usedPercentage;
    final double? sd = rl?.sevenDay?.usedPercentage;
    if (fh == null && sd == null) return const SizedBox.shrink();

    String seg(String label, double? pct) =>
        pct == null ? '$label --' : '$label ${pct.toInt()}%';
    final String text = '${seg('5h', fh)}  \u2022  ${seg('7d', sd)}';
    return Text(
      text,
      style: textTheme.bodySmall?.copyWith(
        color: kMistralBlack.withValues(alpha: 0.7),
      ),
    );
  }
}

class _CtxBar extends StatelessWidget {
  const _CtxBar({
    required this.pct,
    required this.windowSize,
    required this.textStyle,
  });

  final double pct;
  final int? windowSize;
  final TextStyle? textStyle;

  @override
  Widget build(BuildContext context) {
    final double clamped = pct.clamp(0, 100).toDouble();
    final String ctxLabel = windowSize != null ? '$windowSize ctx' : '— ctx';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        SizedBox(
          height: 6,
          child: LayoutBuilder(
            builder: (BuildContext _, BoxConstraints c) {
              final double fillWidth = c.maxWidth * (clamped / 100.0);
              return Stack(
                children: <Widget>[
                  Container(color: kCream),
                  Container(
                    width: fillWidth,
                    color: kMistralOrange,
                  ),
                ],
              );
            },
          ),
        ),
        const SizedBox(height: 4),
        Align(
          alignment: Alignment.centerRight,
          child: Text(
            '${clamped.toInt()}% \u2022 $ctxLabel',
            style: textStyle?.copyWith(
              color: kMistralBlack.withValues(alpha: 0.7),
            ),
          ),
        ),
      ],
    );
  }
}
