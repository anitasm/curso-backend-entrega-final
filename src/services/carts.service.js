const v = require('../utils/validation');
class CartsService {
  constructor(repository, productsService) {
    this.repository = repository;
    this.productsService = productsService;
  }
  async createCart() {
    return this.repository.createCart();
  }
  async getCartById(id) {
    return v.found(await this.repository.getCartById(v.id(id)), 'CART_NOT_FOUND');
  }
  async addProductToCart(cid, pid) {
    v.id(cid);
    v.id(pid);
    await this.productsService.getProductById(pid);
    return v.found(await this.repository.addProductToCart(cid, pid), 'CART_NOT_FOUND');
  }
  async removeProductFromCart(cid, pid) {
    return v.found(
      await this.repository.removeProductFromCart(v.id(cid), v.id(pid)),
      'CART_NOT_FOUND'
    );
  }
  async updateCartProducts(cid, input) {
    v.id(cid);
    if (!Array.isArray(input)) {
      v.fields(input, ['products']);
      input = input.products;
    }
    if (!Array.isArray(input)) v.invalid('Se requiere un arreglo products o un arreglo raíz');
    const products = input.map(item => {
      v.fields(item, ['product', 'quantity']);
      return {
        product: v.id(item.product),
        quantity: v.number(item.quantity, 'quantity', true, 1),
      };
    });
    return v.found(await this.repository.updateCartProducts(cid, products), 'CART_NOT_FOUND');
  }
  async updateProductQuantityInCart(cid, pid, input) {
    v.fields(input, ['quantity']);
    const cart = await this.repository.updateProductQuantityInCart(
      v.id(cid),
      v.id(pid),
      v.number(input.quantity, 'quantity', true, 1)
    );
    return v.found(cart, cart === false ? 'CART_ITEM_NOT_FOUND' : 'CART_NOT_FOUND');
  }
  async clearCart(cid) {
    return v.found(await this.repository.clearCart(v.id(cid)), 'CART_NOT_FOUND');
  }
  async getCartSummary(cid) {
    const cart = await this.getCartById(cid);
    const products = cart.products.map(item => ({
      ...item,
      subtotal: item.product ? item.product.price * item.quantity : 0,
    }));
    return { ...cart, products, total: products.reduce((sum, item) => sum + item.subtotal, 0) };
  }
}
module.exports = CartsService;
