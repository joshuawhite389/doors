Pod::Spec.new do |s|
  s.name           = 'SpokenSession'
  s.version        = '1.0.0'
  s.summary        = "Puts the app's spoken-audio session back after the tap-to-talk mic has recorded"
  s.author         = 'Doors'
  s.homepage       = 'https://example.invalid/doors'
  s.license        = { type: 'UNLICENSED' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,swift}'
end
