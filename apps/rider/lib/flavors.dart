import 'package:santha_api/santha_api.dart' show SanthaApp;
import 'package:santha_core/santha_core.dart';

/// This app's identity on the backend (decides the role granted at first sign-in).
const thisApp = SanthaApp.rider;

AppConfig configFor(Flavor flavor) => AppConfig.forFlavor(flavor, thisApp);
