const gulp = require('gulp');
const babel = require('gulp-babel');

gulp.task('build', () => {
    return gulp.src('./src/**/*.js')
        .pipe(babel())
        .pipe(gulp.dest('./dist'));
});

gulp.task('watch', () => {
    return gulp.watch('./src/**/*.js', ['build']);
});

gulp.task('default', ['build']);
