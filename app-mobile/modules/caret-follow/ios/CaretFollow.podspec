Pod::Spec.new do |s|
  s.name           = 'CaretFollow'
  s.version        = '1.0.0'
  s.summary        = 'Keeps the caret of the text box being edited in view, also while iOS dictation inserts text'
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
