#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <ImageIO/ImageIO.h>
#include <math.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    BOOL wholeImage = argc == 3 && strcmp(argv[2], "--image") == 0;
    BOOL cropOnly = argc == 6 && strcmp(argv[5], "--crop") == 0;
    if (!wholeImage && !cropOnly && argc != 5) return 2;
    NSString *path = [NSString stringWithUTF8String:argv[1]];
    CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path], NULL);
    if (!source) return 2;
    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (!image) return 2;
    double viewportWidth = wholeImage ? CGImageGetWidth(image) : atof(argv[3]);
    double viewportHeight = wholeImage ? CGImageGetHeight(image) : atof(argv[4]);
    NSArray *rects = wholeImage ? @[@{@"x": @0, @"y": @0, @"width": @(viewportWidth), @"height": @(viewportHeight)}]
      : [NSJSONSerialization JSONObjectWithData:[[NSString stringWithUTF8String:argv[2]] dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if (![rects isKindOfClass:[NSArray class]] || !isfinite(viewportWidth) || !isfinite(viewportHeight) || viewportWidth <= 0 || viewportHeight <= 0) {
      CGImageRelease(image); return 2;
    }
    double scaleX = (double)CGImageGetWidth(image) / viewportWidth;
    double scaleY = (double)CGImageGetHeight(image) / viewportHeight;
    CGRect bounds = CGRectMake(0, 0, CGImageGetWidth(image), CGImageGetHeight(image));
    NSMutableArray *output = [NSMutableArray array];
    BOOL failed = NO;
    for (NSUInteger i = 0; i < MIN(rects.count, 4); i++) {
      NSDictionary *rect = rects[i];
      if (![rect isKindOfClass:[NSDictionary class]]) continue;
      double x = [rect[@"x"] doubleValue], y = [rect[@"y"] doubleValue];
      double width = [rect[@"width"] doubleValue], height = [rect[@"height"] doubleValue];
      if (!isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) || width <= 0 || height <= 0) continue;
      CGRect crop = CGRectIntersection(CGRectIntegral(CGRectMake(x * scaleX, y * scaleY, width * scaleX, height * scaleY)), bounds);
      if (CGRectIsNull(crop) || crop.size.width < 1 || crop.size.height < 1) continue;
      CGImageRef clipped = CGRectEqualToRect(crop, bounds) ? CGImageRetain(image) : CGImageCreateWithImageInRect(image, crop);
      if (!clipped) continue;
      if (cropOnly) {
        NSMutableData *png = [NSMutableData data];
        CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)png, CFSTR("public.png"), 1, NULL);
        if (destination) {
          CGImageDestinationAddImage(destination, clipped, NULL);
          if (CGImageDestinationFinalize(destination)) {
            [output addObject:@{@"index": @(i), @"dataUrl": [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]]}];
          }
          CFRelease(destination);
        }
      } else {
        VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
        request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
        request.usesLanguageCorrection = YES;
        request.recognitionLanguages = @[@"en-US", @"zh-Hans"];
        VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:clipped options:@{}];
        NSError *error = nil;
        if ([handler performRequests:@[request] error:&error]) {
          for (VNRecognizedTextObservation *observation in request.results) {
            VNRecognizedText *top = [[observation topCandidates:1] firstObject];
            if (top && top.confidence >= 0.25) [output addObject:@{@"text": top.string, @"confidence": @(top.confidence)}];
          }
        } else {
          failed = YES;
          fprintf(stderr, "Vision unavailable: %s\n", error ? error.localizedDescription.UTF8String : "request failed without detail");
        }
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
