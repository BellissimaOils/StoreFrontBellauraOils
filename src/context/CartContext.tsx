import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Product, CartItem } from '../types';
import { useProducts } from './ProductContext';

interface CartContextType {
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: string;
  isCartOpen: boolean;
  setIsCartOpen: (isOpen: boolean) => void;
  appliedCoupon: {
    id: string;
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    expiresAt?: string | null;
    minCartAmount?: number | null;
    applicableProducts?: string[] | null;
  } | null;
  applyCoupon: (code: string) => Promise<{ success: boolean; message: string }>;
  removeCoupon: () => void;
  discountAmount: number;
  finalPrice: number;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { products } = useProducts();
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<{
    id: string;
    code: string;
    discountType: "percentage" | "fixed";
    discountValue: number;
    expiresAt?: string | null;
    minCartAmount?: number | null;
    applicableProducts?: string[] | null;
  } | null>(() => {
    try {
      const saved = localStorage.getItem('bellaura_coupon');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const savedCart = localStorage.getItem('bellaura_cart');
      return savedCart ? JSON.parse(savedCart) : [];
    } catch (e) {
      console.error('Failed to load cart from localStorage:', e);
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('bellaura_cart', JSON.stringify(cart));
    } catch (e) {
      console.error('Failed to save cart to localStorage:', e);
    }
  }, [cart]);

  // Synchronize cart item details with updated database products/prices
  useEffect(() => {
    if (products && products.length > 0 && cart.length > 0) {
      let changed = false;
      const updatedCart = cart.map(item => {
        const matchingProduct = products.find(p => p.id === item.id);
        if (matchingProduct) {
          const hasPriceDiff = matchingProduct.price !== item.price;
          const hasOrigPriceDiff = matchingProduct.originalPrice !== item.originalPrice;
          const hasSaleDiff = matchingProduct.isSale !== item.isSale;
          const hasNameDiff = matchingProduct.name !== item.name;
          const hasImageDiff = matchingProduct.image !== item.image;

          if (hasPriceDiff || hasOrigPriceDiff || hasSaleDiff || hasNameDiff || hasImageDiff) {
            changed = true;
            return {
              ...item,
              price: matchingProduct.price,
              originalPrice: matchingProduct.originalPrice,
              isSale: matchingProduct.isSale,
              name: matchingProduct.name,
              image: matchingProduct.image
            };
          }
        }
        return item;
      });
      if (changed) {
        setCart(updatedCart);
      }
    }
  }, [products]);

  useEffect(() => {
    if (appliedCoupon) {
      localStorage.setItem('bellaura_coupon', JSON.stringify(appliedCoupon));
    } else {
      localStorage.removeItem('bellaura_coupon');
    }
  }, [appliedCoupon]);

  // Handle live coupon timer verification on client-side
  useEffect(() => {
    if (appliedCoupon && appliedCoupon.expiresAt) {
      const checkExpiry = () => {
        const now = new Date();
        const expiry = new Date(appliedCoupon.expiresAt!);
        if (now > expiry) {
          setAppliedCoupon(null);
        }
      };
      checkExpiry();
      const timer = setInterval(checkExpiry, 2000);
      return () => clearInterval(timer);
    }
  }, [appliedCoupon]);

  const addToCart = useCallback((product: Product, qty: number = 1) => {
    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === product.id);
      if (existingItem) {
        return prevCart.map(item =>
          item.id === product.id ? { ...item, quantity: item.quantity + qty } : item
        );
      }
      return [...prevCart, { ...product, quantity: qty }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart(prevCart => prevCart.filter(item => item.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(prevCart => prevCart.filter(item => item.id !== productId));
      return;
    }
    setCart(prevCart =>
      prevCart.map(item =>
        item.id === productId ? { ...item, quantity } : item
      )
    );
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setAppliedCoupon(null);
  }, []);

  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  
  const totalPriceVal = useMemo(() => cart.reduce((sum, item) => {
    const price = parseFloat(item.price.replace(' DH', ''));
    return sum + (price * item.quantity);
  }, 0), [cart]);

  // Auto-remove coupon if conditions are no longer met when cart items are updated
  useEffect(() => {
    if (appliedCoupon) {
      const hasMinSpendIssue = appliedCoupon.minCartAmount && totalPriceVal < appliedCoupon.minCartAmount;
      const hasProductIssue = appliedCoupon.applicableProducts && appliedCoupon.applicableProducts.length > 0 &&
        !cart.some(item => appliedCoupon.applicableProducts!.includes(item.id));

      if (hasMinSpendIssue || hasProductIssue) {
        setAppliedCoupon(null);
      }
    }
  }, [cart, appliedCoupon, totalPriceVal]);

  const applyCoupon = useCallback(async (code: string) => {
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code,
          cartPrice: totalPriceVal,
          cartItems: cart.map(item => ({ id: item.id, price: item.price, quantity: item.quantity }))
        })
      });
      const data = await response.json();
      if (data.success) {
        setAppliedCoupon(data.coupon);
        return { success: true, message: 'Coupon applied successfully!' };
      } else {
        return { success: false, message: data.message || 'Invalid coupon code' };
      }
    } catch (e) {
      return { success: false, message: 'Network error verifying coupon' };
    }
  }, [cart, totalPriceVal]);

  const removeCoupon = useCallback(() => {
    setAppliedCoupon(null);
  }, []);

  // Determine subtotal for items that are eligible for this coupon
  const eligibleItems = useMemo(() => cart.filter(item => {
    if (!appliedCoupon?.applicableProducts || appliedCoupon.applicableProducts.length === 0) {
      return true;
    }
    return appliedCoupon.applicableProducts!.includes(item.id);
  }), [cart, appliedCoupon]);

  const eligibleSubtotal = useMemo(() => eligibleItems.reduce((sum, item) => {
    const price = parseFloat(item.price.replace(' DH', ''));
    return sum + (price * item.quantity);
  }, 0), [eligibleItems]);

  const discountValRaw = appliedCoupon
    ? appliedCoupon.discountType === 'percentage'
      ? (eligibleSubtotal * (appliedCoupon.discountValue / 100))
      : appliedCoupon.discountValue
    : 0;

  const discountAmount = Math.round(Math.min(discountValRaw, eligibleSubtotal));
  const finalPrice = Math.max(0, Math.round(totalPriceVal - discountAmount));

  const contextValue = useMemo(() => ({
    cart, 
    addToCart, 
    removeFromCart, 
    updateQuantity, 
    clearCart,
    totalItems,
    totalPrice: `${Math.round(totalPriceVal)}`,
    isCartOpen,
    setIsCartOpen,
    appliedCoupon,
    applyCoupon,
    removeCoupon,
    discountAmount,
    finalPrice
  }), [
    cart, 
    addToCart, 
    removeFromCart, 
    updateQuantity, 
    clearCart,
    totalItems,
    totalPriceVal,
    isCartOpen,
    appliedCoupon,
    applyCoupon,
    removeCoupon,
    discountAmount,
    finalPrice
  ]);

  return (
    <CartContext.Provider value={contextValue}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};
