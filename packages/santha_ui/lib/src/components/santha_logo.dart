import 'package:flutter/widgets.dart';

/// Primary lockup (mark + wordmark + సంత). Files are copies of design/brand/logo/*.png.
/// Use [SanthaLogo.reverse] on Indigo, [SanthaLogo.primary] on white. Minimum width 120 px;
/// never recolour, stretch or add effects.
class SanthaLogo extends StatelessWidget {
  const SanthaLogo.primary({super.key, this.width = 160}) : _asset = 'santha-primary.png';
  const SanthaLogo.reverse({super.key, this.width = 160}) : _asset = 'santha-primary-reverse.png';

  final double width;
  final String _asset;

  static const _aspect = 2340 / 660;

  @override
  Widget build(BuildContext context) => Image.asset(
        'assets/brand/$_asset',
        package: 'santha_ui',
        width: width < 120 ? 120 : width,
        height: (width < 120 ? 120 : width) / _aspect,
        fit: BoxFit.contain,
        semanticLabel: 'Santha',
      );
}
