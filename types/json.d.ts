// TypeScript can't infer from JSON :(
declare module "*.json" {
    const value: any;
    export default value;
}