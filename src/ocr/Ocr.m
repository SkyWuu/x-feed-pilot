#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <ImageIO/ImageIO.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 5) return 2;
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    NSData *rectData = [[NSString stringWithUTF8String:argv[2]] dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *rects = [NSJSONSerialization JSONObjectWithData:rectData options:0 error:nil];
    double viewportWidth = atof(argv[3]);
    double viewportHeight = atof(argv[4]);
    if (!rects || viewportWidth <= 0 || viewportHeight <= 0) return 2;
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], NULL);
    if (!source) return 2;
    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (!image) return 2;
    double scaleX = (double)CGImageGetWidth(image) / viewportWidth;
    double scaleY = (double)CGImageGetHeight(image) / viewportHeight;
    CGRect bounds = CGRectMake(0, 0, CGImageGetWidth(image), CGImageGetHeight(image));
    NSMutableArray *output = [NSMutableArray array];
    BOOL failed = NO;
    NSUInteger count = MIN(rects.count, 4);
    for (NSUInteger i = 0; i < count; i++) {
      NSDictionary *rect = rects[i];
      CGRect crop = CGRectMake([rect[@"x"] doubleValue] * scaleX,
                               [rect[@"y"] doubleValue] * scaleY,
                               [rect[@"width"] doubleValue] * scaleX,
                               [rect[@"height"] doubleValue] * scaleY);
      crop = CGRectIntegral(CGRectIntersection(crop, bounds));
      if (CGRectIsNull(crop) || crop.size.width < 20 || crop.size.height < 20) continue;
      CGImageRef clipped = CGRectEqualToRect(crop, bounds) ? CGImageRetain(image) : CGImageCreateWithImageInRect(image, crop);
      if (!clipped) continue;
      VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
      request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
      request.usesLanguageCorrection = YES;
      request.recognitionLanguages = @[@"en-US", @"zh-Hans"];
      VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:clipped options:@{}];
      NSError *error = nil;
      BOOL performed = [handler performRequests:@[request] error:&error];
      if (performed) {
        for (VNRecognizedTextObservation *observation in request.results) {
          VNRecognizedText *top = [[observation topCandidates:1] firstObject];
          if (top && top.confidence >= 0.25) {
            [output addObject:@{@"text": top.string, @"confidence": @(top.confidence)}];
          }
        }
      } else {
        failed = YES;
        fprintf(stderr, "Vision unavailable: %s\n", error ? error.localizedDescription.UTF8String : "request failed without detail");
      }
      CGImageRelease(clipped);
    }
    CGImageRelease(image);
    if (failed) return 3;
    NSData *result = [NSJSONSerialization dataWithJSONObject:output options:0 error:nil];
    if (!result) return 2;
    fwrite(result.bytes, 1, result.length, stdout);
    fputc('\n', stdout);
  }
  return 0;
}
