import 'package:flutter/material.dart';

import '../theme/mistral_theme.dart';
import '../widgets/section_label.dart';

// Temporary detail screen. Replaced by the real detail UI in P2.4.
class SessionDetailPlaceholder extends StatelessWidget {
  const SessionDetailPlaceholder({required this.sessionId, super.key});

  final String sessionId;

  @override
  Widget build(BuildContext context) {
    final TextTheme t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: const SectionLabel(label: 'SESSION')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(sessionId, style: t.headlineLarge),
            const SizedBox(height: 16),
            Text(
              'Detail screen coming in P2.4.',
              style: t.bodyLarge?.copyWith(
                color: kMistralBlack.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
