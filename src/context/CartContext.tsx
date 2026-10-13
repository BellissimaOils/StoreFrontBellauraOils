import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Product, CartItem, LivePack } from '../types';
import { useProducts } from './ProductContext';
import { tracker } from '../lib/tracker';

interface CartContextType {
  cart: CartItem[];
  addToCart: (product: Product, qty?: number) => void;
  addLivePackToCart: (pack: LivePack, qty?: number) => void;
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
        // Live Packs are commercial promotional bundles — do NOT overwrite with single products
        if (item.isLivePack) return item;

        const matchingProduct = products.find(p => p.id === item.id);
        if (matchingProduct) {
          let newPrice = matchingProduct.price;
          let newOrigPrice = matchingProduct.originalPrice;
          let newIsSale = matchingProduct.isSale;

          if (item.selectedSize) {
            const matchedSize = matchingProduct.sizes?.find(s => s.size === item.selectedSize?.size);
            if (matchedSize) {
              newPrice = matchedSize.price;
              newOrigPrice = matchedSize.originalPrice || undefined;
              const nP = parseFloat(String(matchedSize.price).replace(/[^\d.]/g, '')) || 0;
              const nOP = parseFloat(String(matchedSize.originalPrice || '').replace(/[^\d.]/g, '')) || 0;
              newIsSale = nOP > nP;
            } else {
              newPrice = item.price;
              newOrigPrice = item.originalPrice;
              newIsSale = item.isSale;
            }
          }

          const hasPriceDiff = newPrice !== item.price;
          const hasOrigPriceDiff = newOrigPrice !== item.originalPrice;
          const hasSaleDiff = newIsSale !== item.isSale;
          const hasNameDiff = matchingProduct.name !== item.name;
          const hasImageDiff = matchingProduct.image !== item.image;

          if (hasPriceDiff || hasOrigPriceDiff || hasSaleDiff || hasNameDiff || hasImageDiff) {
            changed = true;
            return {
              ...item,
              price: newPrice,
              originalPrice: newOrigPrice,
              isSale: newIsSale,
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
    const itemCartKey = product.selectedSize?.size
      ? `${product.id}__size_${product.selectedSize.size}`
      : product.id;

    const numericPrice = parseFloat(String(product.price || 0).replace(/[^\d.]/g, '')) || 0;
    tracker.track('add_to_cart', {
      productId: String(product.id),
      productName: product.name,
      quantity: qty,
      unitPrice: numericPrice,
    });

    setCart(prevCart => {
      const existingItem = prevCart.find(item =>
        (item.cartItemId || (item.selectedSize?.size ? `${item.id}__size_${item.selectedSize.size}` : item.id)) === itemCartKey
      );
      if (existingItem) {
        return prevCart.map(item =>
          (item.cartItemId || (item.selectedSize?.size ? `${item.id}__size_${item.selectedSize.size}` : item.id)) === itemCartKey
            ? { ...item, quantity: item.quantity + qty }
            : item
        );
      }
      return [...prevCart, { ...product, cartItemId: itemCartKey, quantity: qty }];
    });
  }, []);

  const addLivePackToCart = useCallback((pack: LivePack, qty: number = 1) => {
    const livePackCartId = `live_pack_${pack.id}`;
    const repImage = pack.products?.[0]?.image || "";

    tracker.track('add_to_cart', {
      productId: livePackCartId,
      productName: pack.name,
      quantity: qty,
      unitPrice: pack.live_price,
    });

    const packItem: CartItem = {
      id: livePackCartId,
      name: pack.name,
      category: "عروض اللايف",
      price: `${Math.round(pack.live_price)} DH`,
      originalPrice: pack.regular_price > pack.live_price ? `${Math.round(pack.regular_price)} DH` : undefined,
      isSale: pack.regular_price > pack.live_price,
      image: repImage,
      description: pack.description || "",
      quantity: qty,
      isLivePack: true,
      livePackId: pack.id,
      includedProducts: (pack.products || []).map((p) => ({
        id: String(p.id),
        name: p.name,
        name_en: p.name_en,
        name_ar: p.name_ar,
        image: p.image,
        price: p.price,
        volume: p.volume || p.size_label,
      })),
    };

    setCart(prevCart => {
      const existingItem = prevCart.find(item => item.id === livePackCartId);
      if (existingItem) {
        return prevCart.map(item =>
          item.id === livePackCartId ? { ...item, quantity: item.quantity + qty } : item
        );
      }
      return [...prevCart, packItem];
    });
    setIsCartOpen(true);
  }, []);

  const removeFromCart = useCallback((itemKey: string) => {
    tracker.track('remove_from_cart', {
      productId: String(itemKey),
      quantity: 1,
    });
    setCart(prevCart => prevCart.filter(item => {
      const k = item.cartItemId || (item.selectedSize?.size ? `${item.id}__size_${item.selectedSize.size}` : item.id);
      return k !== itemKey && item.id !== itemKey;
    }));
  }, []);

  const updateQuantity = useCallback((itemKey: string, quantity: number) => {
    if (quantity <= 0) {
      tracker.track('remove_from_cart', {
        productId: String(itemKey),
        quantity: 1,
      });
      setCart(prevCart => prevCart.filter(item => {
        const k = item.cartItemId || (item.selectedSize?.size ? `${item.id}__size_${item.selectedSize.size}` : item.id);
        return k !== itemKey && item.id !== itemKey;
      }));
      return;
    }
    setCart(prevCart =>
      prevCart.map(item => {
        const k = item.cartItemId || (item.selectedSize?.size ? `${item.id}__size_${item.selectedSize.size}` : item.id);
        return (k === itemKey || item.id === itemKey) ? { ...item, quantity } : item;
      })
    );
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setAppliedCoupon(null);
  }, []);

  const totalItems = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  
  const totalPriceVal = useMemo(() => cart.reduce((sum, item) => {
    const rawPrice = item.price ? String(item.price).replace(/[^\d.]/g, '') : "0";
    const price = parseFloat(rawPrice) || 0;
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
    addLivePackToCart,
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
    addLivePackToCart,
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
