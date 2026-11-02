import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:santha_api/santha_api.dart';
import 'package:santha_core/santha_core.dart';
import 'package:santha_ui/santha_ui.dart';

import '../../../l10n/gen/app_localizations.dart';
import '../../catalogue/data/catalogue_controller.dart';
import '../data/onboarding_controller.dart';
import 'copy.dart';

const maxStorePhotos = 6;

/// Store photos (onboarding step, ADR-006): camera or gallery → media pipeline → moderation.
/// The step is done once one photo is attached; customers see only approved photos.
class StorePhotosStep extends ConsumerStatefulWidget {
  const StorePhotosStep({super.key, required this.view});
  final MerchantView view;
  @override
  ConsumerState<StorePhotosStep> createState() => _StorePhotosStepState();
}

class _StorePhotosStepState extends ConsumerState<StorePhotosStep> {
  bool _busy = false;
  String? _error;

  Future<void> _change(Future<void> Function() action) async {
    final l = AppLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) setState(() => _error = e is ApiException && e.code == 'VALIDATION_FAILED' ? l.errPhoto : l.apiError(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _add(bool camera) async {
    final picked = await ref.read(photoPickerProvider)(camera: camera);
    if (picked == null) return;
    await _change(() async {
      final api = ref.read(catalogueApiProvider);
      final media = await api.uploadPhoto(picked.bytes, contentType: picked.contentType, store: true);
      final current = ref.read(onboardingProvider).value?.photos.map((p) => p.id) ?? const <String>[];
      await ref.read(onboardingProvider.notifier).setPhotos([...current, media.id]);
      ref.read(analyticsProvider).track('onboarding_step_completed', {'step': 'photos'});
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final view = ref.watch(onboardingProvider).value ?? widget.view;
    final client = ref.read(apiClientProvider);
    final full = view.photos.length >= maxStorePhotos;
    return Scaffold(
      appBar: AppBar(title: Text(l.photosTitle)),
      body: ListView(
        padding: const EdgeInsets.all(SanthaSpacing.s6),
        children: [
          Text(l.photosSub, style: text.bodyMedium?.copyWith(color: SanthaColors.slate)),
          const SizedBox(height: SanthaSpacing.s4),
          GridView.count(
            crossAxisCount: 3,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: SanthaSpacing.s2,
            crossAxisSpacing: SanthaSpacing.s2,
            children: [
              for (final p in view.photos)
                Stack(key: ValueKey('photo-${p.id}'), fit: StackFit.expand, children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(SanthaRadius.md),
                    child: p.thumbUrl == null
                        ? const ColoredBox(color: SanthaColors.sky)
                        : Image.network(client.resolve(p.thumbUrl!), fit: BoxFit.cover, semanticLabel: l.photosTitle, errorBuilder: (_, _, _) => const ColoredBox(color: SanthaColors.sky)),
                  ),
                  Positioned(
                    left: 4,
                    bottom: 4,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(color: SanthaColors.white.withValues(alpha: 0.9), borderRadius: BorderRadius.circular(SanthaRadius.pill)),
                      child: Text(
                        switch (p.status) {
                          MediaStatus.approved => l.photoApproved,
                          MediaStatus.rejected => l.photoRejected,
                          _ => l.photoPending,
                        },
                        style: text.labelSmall?.copyWith(color: p.status == MediaStatus.rejected ? SanthaColors.chilli : SanthaColors.ink),
                      ),
                    ),
                  ),
                  Positioned(
                    right: 0,
                    top: 0,
                    child: IconButton(
                      tooltip: l.photoRemove,
                      icon: const Icon(Icons.close, color: SanthaColors.white),
                      onPressed: _busy
                          ? null
                          : () => _change(() => ref.read(onboardingProvider.notifier).setPhotos(view.photos.where((x) => x.id != p.id).map((x) => x.id).toList())),
                    ),
                  ),
                ]),
            ],
          ),
          const SizedBox(height: SanthaSpacing.s4),
          if (_busy) Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s4), child: Text(l.photoUploading)),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: SanthaSpacing.s4), child: Text(_error!, style: const TextStyle(color: SanthaColors.chilli))),
          if (full) Text(l.photoMax(maxStorePhotos), style: text.bodySmall),
          SanthaButton(key: const ValueKey('photo-camera'), label: l.photoTake, onPressed: _busy || full ? null : () => _add(true)),
          const SizedBox(height: SanthaSpacing.s3),
          SanthaButton(key: const ValueKey('photo-gallery'), label: l.photoPick, variant: SanthaButtonVariant.outline, onPressed: _busy || full ? null : () => _add(false)),
        ],
      ),
    );
  }
}
